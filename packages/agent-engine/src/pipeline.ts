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
  status?: "completed" | "paused";
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
}

export interface PipelineRunState {
  status: PipelineStatus;
  currentStepIndex: number;
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
          data: { ...(options.initialData ?? {}) },
          results: []
        };

    for (let index = runState.currentStepIndex; index < this.steps.length; index += 1) {
      const step = this.steps[index];
      runState.currentStepIndex = index;

      if (!autoCommit && runState.results.length > 0) {
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
    return this.run({ ...options, autoCommit: true }, { ...state, currentStepIndex: state.currentStepIndex });
  }

  private resolveStepData(step: PipelineStep, state: PipelineRunState): PipelineData {
    if (!step.inputFrom) return { ...state.data };
    const refs = Array.isArray(step.inputFrom) ? step.inputFrom : [step.inputFrom];
    const data: PipelineData = {};
    for (const ref of refs) {
      data[ref] = state.data[ref];
    }
    return data;
  }
}
