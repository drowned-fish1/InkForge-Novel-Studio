export type PipelineData = Record<string, unknown>;
export type PipelineStatus = "idle" | "running" | "paused" | "failed" | "completed";

export interface PipelineStepInput {
  data: PipelineData;
  previous?: PipelineStepResult;
}

export interface PipelineStepResult {
  id: string;
  output?: unknown;
  data?: PipelineData;
  status?: "completed" | "paused" | "skipped";
  message?: string;
}

export interface PipelineStep {
  id: string;
  title?: string;
  inputFrom?: string | string[];
  run: (input: PipelineStepInput) => PipelineStepResult | Promise<PipelineStepResult>;
}

export interface PipelineRunnerOptions {
  autoCommit?: boolean;
  stopOnError?: boolean;
  initialData?: PipelineData;
  maxSteps?: number;
}

export interface PipelineRunState {
  status: PipelineStatus;
  currentStepIndex: number;
  initialData: PipelineData;
  data: PipelineData;
  results: PipelineStepResult[];
  pendingStep?: PipelineStep;
  error?: Error;
}

export class PipelineRunner {
  private readonly steps: PipelineStep[];

  constructor(steps: PipelineStep[]) {
    this.steps = steps;
  }

  async run(options: PipelineRunnerOptions = {}, state?: PipelineRunState): Promise<PipelineRunState> {
    const stopOnError = options.stopOnError ?? true;
    const autoCommit = options.autoCommit ?? true;
    const runState: PipelineRunState = state
      ? { ...state, status: "running", error: undefined }
      : {
          status: "running",
          currentStepIndex: 0,
          initialData: { ...(options.initialData ?? {}) },
          data: { ...(options.initialData ?? {}) },
          results: []
        };
    let executedThisRun = 0;

    for (let index = runState.currentStepIndex; index < this.steps.length; index += 1) {
      const step = this.steps[index];
      runState.currentStepIndex = index;

      if ((!autoCommit && executedThisRun > 0) || (options.maxSteps && executedThisRun >= options.maxSteps)) {
        runState.status = "paused";
        runState.pendingStep = step;
        return runState;
      }

      try {
        const result = await step.run({
          data: this.resolveStepData(step, runState),
          previous: runState.results.at(-1)
        });
        const committed = { ...result, id: result.id || step.id };
        runState.results.push(committed);
        executedThisRun += 1;
        runState.data[step.id] = committed.output;
        if (committed.data) {
          runState.data = { ...runState.data, ...committed.data };
        }
        if (committed.status === "paused") {
          runState.status = "paused";
          runState.currentStepIndex = index + 1;
          runState.pendingStep = this.steps[index + 1];
          return runState;
        }
      } catch (error) {
        runState.error = error instanceof Error ? error : new Error(String(error));
        runState.status = stopOnError ? "failed" : "running";
        if (stopOnError) return runState;
      }
    }

    runState.status = "completed";
    runState.currentStepIndex = this.steps.length;
    runState.pendingStep = undefined;
    return runState;
  }

  async continue(state: PipelineRunState, options: PipelineRunnerOptions = {}): Promise<PipelineRunState> {
    return this.run(
      { ...options, autoCommit: options.autoCommit ?? true },
      { ...state, currentStepIndex: state.currentStepIndex }
    );
  }

  skipPending(state: PipelineRunState): PipelineRunState {
    const step = state.pendingStep ?? this.steps[state.currentStepIndex];
    if (!step) {
      throw new Error("No pending pipeline step to skip.");
    }
    const nextIndex = state.currentStepIndex + 1;
    const result: PipelineStepResult = {
      id: step.id,
      status: "skipped",
      output: { skipped: true },
      message: `${step.title ?? step.id} skipped by author.`
    };
    return {
      ...state,
      status: nextIndex >= this.steps.length ? "completed" : "paused",
      currentStepIndex: nextIndex,
      pendingStep: this.steps[nextIndex],
      results: [...state.results, result],
      data: { ...state.data, [step.id]: result.output },
      error: undefined
    };
  }

  async retryFailed(state: PipelineRunState): Promise<PipelineRunState> {
    if (state.status !== "failed") {
      throw new Error("Only a failed pipeline step can be retried.");
    }
    return this.run(
      { autoCommit: false, maxSteps: 1 },
      { ...state, status: "running", pendingStep: undefined, error: undefined }
    );
  }

  private resolveStepData(step: PipelineStep, state: PipelineRunState): PipelineData {
    if (!step.inputFrom) return { ...state.data };
    const refs = Array.isArray(step.inputFrom) ? step.inputFrom : [step.inputFrom];
    const data: PipelineData = { ...state.initialData };
    for (const ref of refs) {
      data[ref] = state.data[ref];
    }
    return data;
  }
}
