import { randomUUID } from "node:crypto";
import path from "node:path";
import { ChapterContractSchema, EvidencePackSchema, type ChapterContract, type EvidencePack } from "@inkforge/schemas";
import type { ChatCompletionMessage } from "@inkforge/ai-provider";
import { AiProviderService, type AgentCompletionInput, type AgentCompletionResult } from "./AiProviderService.js";
import { BranchService } from "./BranchService.js";
import { CanonStore } from "./CanonStore.js";
import { ContextCompiler, renderEvidencePack } from "./ContextCompiler.js";
import { ContinuationValidator, type ContinuationValidationReport } from "./ContinuationValidator.js";
import { FileRepository } from "./FileRepository.js";
import { HybridRetriever } from "./HybridRetriever.js";
import { ChunkIndexService } from "./ChunkIndexService.js";
import { ProjectService } from "./ProjectService.js";
import { StyleProfileService, type StyleEvaluationResult } from "./StyleProfileService.js";
import { StoryThreadService } from "./StoryThreadService.js";

/** A durable lifecycle stage.  The checkpoint is intentionally human-readable
 * so a future renderer can resume or explain a run without replaying logs. */
export type ContinuationRunPhase =
  | "created"
  | "evidence-compiled"
  | "generating"
  | "draft-generated"
  | "branch-created"
  | "validated"
  | "completed"
  | "blocked"
  | "failed"
  | "cancelled";

export type ContinuationRunStatus = "queued" | "running" | "completed" | "blocked" | "failed" | "cancelled";

export interface ContinuationRunCheckpoint {
  phase: ContinuationRunPhase;
  updatedAt: string;
  message?: string;
}

/** Usage is normalized to the camelCase shape used by the renderer services. */
export interface ContinuationUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  model?: string;
}

export interface ContinuationRun {
  schemaVersion: 1;
  id: string;
  projectPath: string;
  chapterId: string;
  contract: ChapterContract;
  instruction: string;
  status: ContinuationRunStatus;
  checkpoint: ContinuationRunCheckpoint;
  branchId?: string;
  evidencePack?: EvidencePack;
  draft?: string;
  validation?: ContinuationValidationReport;
  styleEvaluation?: StyleEvaluationResult;
  usage?: ContinuationUsage;
  model?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContinuationRunInput {
  projectPath: string;
  chapterId: string;
  contract: ChapterContract;
  instruction?: string;
  /** Supplying an id is useful to callers that need deterministic idempotency. */
  runId?: string;
  requestId?: string;
  tokenBudget?: number;
  retrievalLimit?: number;
  maxOutputTokens?: number;
  modelOverride?: string;
  useEditorModel?: boolean;
  branchName?: string;
  branchDescription?: string;
}

export interface ContinuationRetryInput {
  instruction?: string;
  tokenBudget?: number;
  retrievalLimit?: number;
  maxOutputTokens?: number;
  modelOverride?: string;
  useEditorModel?: boolean;
  branchName?: string;
  branchDescription?: string;
  requestId?: string;
}

export interface ContinuationRunResult {
  /** The complete durable record, also exposed as `run` for IPC callers. */
  run: ContinuationRun;
  id: string;
  status: ContinuationRunStatus;
  projectPath: string;
  chapterId: string;
  checkpoint: ContinuationRunCheckpoint;
  branchId?: string;
  evidencePack?: EvidencePack;
  validation?: ContinuationValidationReport;
  usage?: ContinuationUsage;
  draft?: string;
  error?: string;
}

export interface ContinuationProvider {
  runAgentCompletion(
    input: AgentCompletionInput,
    onDelta?: (delta: { type: "text" | "reasoning"; content: string }) => void
  ): Promise<AgentCompletionResult>;
  cancelTask?(requestId: string): void;
}

export interface ContinuationOrchestratorDependencies {
  files?: FileRepository;
  projects?: ProjectService;
  provider?: ContinuationProvider;
  branches?: Pick<BranchService, "create">;
  compiler?: Pick<ContextCompiler, "compile">;
  validator?: Pick<ContinuationValidator, "validate">;
  styles?: Pick<StyleProfileService, "load" | "evaluateText">;
}

const continuationRunsFile = path.posix.join(".inkforge", "continuation", "runs.json");
const maxStoredRuns = 100;

/**
 * Coordinates the long-form continuation pipeline.  Every externally visible
 * stage is persisted before the next one begins.  Generated prose is always
 * placed in a StoryBranch; the source chapter is never written by this class.
 */
export class ContinuationOrchestrator {
  private readonly files: FileRepository;
  private readonly projects: ProjectService;
  /** Constructed lazily so list/get can be used by a headless recovery process. */
  private provider?: ContinuationProvider;
  private readonly branches: Pick<BranchService, "create">;
  private readonly compiler: Pick<ContextCompiler, "compile">;
  private readonly validator: Pick<ContinuationValidator, "validate">;
  private readonly styles: Pick<StyleProfileService, "load" | "evaluateText">;
  private readonly controls = new Map<string, { cancelled: boolean; requestId?: string }>();
  private readonly mutationQueues = new Map<string, Promise<void>>();

  constructor(dependencies: ContinuationOrchestratorDependencies = {}) {
    this.files = dependencies.files ?? new FileRepository();
    this.projects = dependencies.projects ?? new ProjectService(this.files);
    this.provider = dependencies.provider;
    this.branches = dependencies.branches ?? new BranchService(this.files, this.projects);
    this.compiler =
      dependencies.compiler ??
      new ContextCompiler(
        this.files,
        this.projects,
        new CanonStore(this.files),
        new StoryThreadService(this.files),
        new HybridRetriever(new ChunkIndexService(this.files))
      );
    this.validator = dependencies.validator ?? new ContinuationValidator();
    this.styles = dependencies.styles ?? new StyleProfileService(this.files, this.projects);
  }

  /** List durable runs for one project, newest first. */
  async list(projectPath: string): Promise<ContinuationRun[]> {
    const runs = await this.readRuns(projectPath);
    return runs.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async get(projectPath: string, runId: string): Promise<ContinuationRun | undefined> {
    return (await this.readRuns(projectPath)).find((run) => run.id === runId);
  }

  /** Run a new continuation from evidence compilation through validation. */
  async run(input: ContinuationRunInput): Promise<ContinuationRunResult> {
    const projectPath = path.resolve(input.projectPath);
    const chapterId = input.chapterId.trim();
    if (!chapterId) throw new Error("A chapter id is required.");
    const contract = normalizeContract(input.contract, chapterId);
    const id = input.runId?.trim() || randomUUID();
    if (await this.get(projectPath, id)) {
      throw new Error(`Continuation run already exists: ${id}`);
    }
    const now = new Date().toISOString();
    const run = parseRun({
      schemaVersion: 1,
      id,
      projectPath,
      chapterId,
      contract,
      instruction: input.instruction?.trim() ?? "",
      status: "queued",
      checkpoint: { phase: "created", updatedAt: now },
      createdAt: now,
      updatedAt: now
    });
    await this.upsert(projectPath, run);
    return this.execute(run, toExecutionInput(input, projectPath, chapterId, contract, id));
  }

  /** Alias used by IPC adapters that call the lifecycle entry point start. */
  async start(input: ContinuationRunInput): Promise<ContinuationRunResult> {
    return this.run(input);
  }

  /** Alias retained for callers that model a run as a create operation. */
  async create(input: ContinuationRunInput): Promise<ContinuationRunResult> {
    return this.run(input);
  }

  /**
   * Retry a failed, blocked, or cancelled run in place.  A fresh branch is
   * created on every retry; the previous branch remains available for review.
   */
  async retry(
    projectPath: string,
    runId: string,
    options: ContinuationRetryInput | string = {}
  ): Promise<ContinuationRunResult> {
    const resolvedProjectPath = path.resolve(projectPath);
    const previous = await this.require(resolvedProjectPath, runId);
    if (this.controls.has(previous.id)) {
      throw new Error(`Continuation run ${previous.id} is already running.`);
    }
    if (previous.status === "completed") {
      return this.toResult(previous);
    }
    const retryOptions: ContinuationRetryInput = typeof options === "string" ? { instruction: options } : options;
    const now = new Date().toISOString();
    const next = parseRun({
      ...previous,
      status: "queued",
      error: undefined,
      branchId: undefined,
      evidencePack: undefined,
      draft: undefined,
      validation: undefined,
      styleEvaluation: undefined,
      usage: undefined,
      model: undefined,
      instruction: retryOptions.instruction?.trim() ?? previous.instruction,
      checkpoint: { phase: "created", updatedAt: now, message: "Retry requested." },
      updatedAt: now
    });
    await this.upsert(resolvedProjectPath, next);
    const input: ContinuationRunInput = {
      projectPath: resolvedProjectPath,
      chapterId: next.chapterId,
      contract: next.contract,
      instruction: next.instruction,
      runId: next.id,
      requestId: retryOptions.requestId,
      tokenBudget: retryOptions.tokenBudget,
      retrievalLimit: retryOptions.retrievalLimit,
      maxOutputTokens: retryOptions.maxOutputTokens,
      modelOverride: retryOptions.modelOverride,
      useEditorModel: retryOptions.useEditorModel,
      branchName: retryOptions.branchName,
      branchDescription: retryOptions.branchDescription
    };
    return this.execute(next, input);
  }

  async resume(
    projectPath: string,
    runId: string,
    options: ContinuationRetryInput | string = {}
  ): Promise<ContinuationRunResult> {
    return this.retry(projectPath, runId, options);
  }

  /** Request cancellation and persist it immediately, even if the provider is slow. */
  async cancel(projectPath: string, runId: string): Promise<ContinuationRun> {
    const resolvedProjectPath = path.resolve(projectPath);
    const current = await this.require(resolvedProjectPath, runId);
    if (current.status === "completed" || current.status === "blocked" || current.status === "failed") {
      return current;
    }
    const control = this.controls.get(current.id) ?? { cancelled: false };
    control.cancelled = true;
    this.controls.set(current.id, control);
    if (control.requestId) this.provider?.cancelTask?.(control.requestId);
    const cancelled = updateRun(current, {
      status: "cancelled",
      error: "Continuation run cancelled by the author.",
      checkpoint: { phase: "cancelled", message: "Cancelled by the author." }
    });
    await this.upsert(resolvedProjectPath, cancelled);
    return cancelled;
  }

  private async execute(run: ContinuationRun, input: ContinuationRunInput): Promise<ContinuationRunResult> {
    const control = { cancelled: false, requestId: input.requestId ?? `continuation-${run.id}` };
    this.controls.set(run.id, control);
    let current = updateRun(run, { status: "running", error: undefined });
    await this.upsert(input.projectPath, current);
    try {
      this.assertNotCancelled(run.id);
      const evidencePack = EvidencePackSchema.parse(
        await this.compiler.compile({
          projectPath: input.projectPath,
          chapterId: input.chapterId,
          contract: input.contract,
          instruction: input.instruction,
          tokenBudget: input.tokenBudget,
          retrievalLimit: input.retrievalLimit
        })
      );
      current = updateRun(current, {
        status: "running",
        evidencePack,
        checkpoint: { phase: "evidence-compiled" }
      });
      await this.upsert(input.projectPath, current);
      this.assertNotCancelled(run.id);

      const { chapterTitle, currentContent } = await this.readChapter(input.projectPath, input.chapterId);
      current = updateRun(current, { checkpoint: { phase: "generating" } });
      await this.upsert(input.projectPath, current);
      const completion = await this.getProvider().runAgentCompletion(
        {
          requestId: control.requestId,
          messages: buildContinuationMessages({
            chapterId: input.chapterId,
            chapterTitle,
            contract: input.contract,
            instruction: input.instruction,
            evidencePack
          }),
          maxOutputTokens: input.maxOutputTokens,
          modelOverride: input.modelOverride,
          useEditorModel: input.useEditorModel,
          toolChoice: "none"
        },
        undefined
      );
      this.assertNotCancelled(run.id);
      const draft = extractDraft(completion);
      if (!draft) throw new Error("Provider returned an empty continuation draft.");
      const usage = normalizeUsage(completion, completion.model);
      current = updateRun(current, {
        status: "running",
        draft,
        usage,
        model: completion.model,
        checkpoint: { phase: "draft-generated" }
      });
      await this.upsert(input.projectPath, current);
      this.assertNotCancelled(run.id);

      const branchContent = appendDraft(currentContent, draft);
      const branch = await this.branches.create({
        projectPath: input.projectPath,
        chapterId: input.chapterId,
        name:
          input.branchName?.trim() ||
          `Continuation draft · ${input.contract.title?.trim() || chapterTitle || input.chapterId}`,
        description:
          input.branchDescription?.trim() ||
          `Generated by continuation run ${run.id}. The source chapter remains unchanged until author approval.`,
        content: branchContent,
        source: "agent"
      });
      current = updateRun(current, {
        status: "running",
        branchId: branch.id,
        checkpoint: { phase: "branch-created" }
      });
      await this.upsert(input.projectPath, current);
      this.assertNotCancelled(run.id);

      const styleProfile = await this.styles.load(input.projectPath);
      const styleEvaluation = styleProfile
        ? await this.styles.evaluateText(input.projectPath, draft).catch(() => undefined)
        : undefined;
      const validation = this.validator.validate({
        draft,
        contract: input.contract,
        hardConstraints: evidencePack.hardConstraints,
        dueThreads: evidencePack.dueThreads,
        styleProfile,
        styleEvaluation
      });
      current = updateRun(current, {
        status: validation.canApply ? "completed" : "blocked",
        validation,
        styleEvaluation,
        checkpoint: {
          phase: validation.canApply ? "completed" : "blocked",
          message: validation.canApply
            ? "Draft is ready for author review."
            : "Hard validation failures require review."
        }
      });
      await this.upsert(input.projectPath, current);
      return this.toResult(current);
    } catch (error) {
      const cancelled = isCancelledError(error) || this.isCancelled(run.id);
      current = updateRun(current, {
        status: cancelled ? "cancelled" : "failed",
        error: cancelled ? "Continuation run cancelled by the author." : errorMessage(error),
        checkpoint: {
          phase: cancelled ? "cancelled" : "failed",
          message: cancelled ? "Cancelled by the author." : errorMessage(error)
        }
      });
      await this.upsert(input.projectPath, current).catch(() => undefined);
      return this.toResult(current);
    } finally {
      this.controls.delete(run.id);
    }
  }

  private async readChapter(
    projectPath: string,
    chapterId: string
  ): Promise<{ chapterTitle: string; currentContent: string }> {
    const project = await this.projects.openProject(projectPath);
    const chapter = project.outline.volumes.flatMap((volume) => volume.chapters).find((item) => item.id === chapterId);
    if (!chapter) throw new Error(`Chapter not found: ${chapterId}`);
    return {
      chapterTitle: chapter.title,
      currentContent: await this.files.readText(this.files.assertInsideProject(projectPath, chapter.file))
    };
  }

  private async require(projectPath: string, runId: string): Promise<ContinuationRun> {
    const run = await this.get(projectPath, runId);
    if (!run) throw new Error(`Continuation run not found: ${runId}`);
    return run;
  }

  private async readRuns(projectPath: string): Promise<ContinuationRun[]> {
    try {
      const raw = await this.files.readJson<unknown[]>(this.runPath(projectPath));
      if (!Array.isArray(raw)) throw new Error("Invalid continuation run store.");
      return raw.flatMap((item) => {
        try {
          return [parseRun(item)];
        } catch {
          return [];
        }
      });
    } catch (error) {
      if (isMissingFile(error)) return [];
      throw error;
    }
  }

  private async upsert(projectPath: string, run: ContinuationRun): Promise<void> {
    const key = path.resolve(projectPath);
    const previous = this.mutationQueues.get(key) ?? Promise.resolve();
    const operation = previous
      .catch(() => undefined)
      .then(async () => {
        const existing = await this.readRuns(projectPath);
        await this.files.writeJsonAtomic(
          this.runPath(projectPath),
          [run, ...existing.filter((item) => item.id !== run.id)].slice(0, maxStoredRuns)
        );
      });
    this.mutationQueues.set(key, operation);
    try {
      await operation;
    } finally {
      if (this.mutationQueues.get(key) === operation) this.mutationQueues.delete(key);
    }
  }

  private runPath(projectPath: string): string {
    return this.files.assertInsideProject(projectPath, continuationRunsFile);
  }

  private assertNotCancelled(runId: string): void {
    if (this.isCancelled(runId)) throw new ContinuationCancelledError();
  }

  private isCancelled(runId: string): boolean {
    return this.controls.get(runId)?.cancelled ?? false;
  }

  private getProvider(): ContinuationProvider {
    return (this.provider ??= new AiProviderService());
  }

  private toResult(run: ContinuationRun): ContinuationRunResult {
    return {
      run,
      id: run.id,
      status: run.status,
      projectPath: run.projectPath,
      chapterId: run.chapterId,
      checkpoint: run.checkpoint,
      branchId: run.branchId,
      evidencePack: run.evidencePack,
      validation: run.validation,
      usage: run.usage,
      draft: run.draft,
      error: run.error
    };
  }
}

const normalizeContract = (contract: ChapterContract, chapterId: string): ChapterContract => {
  const contractChapterId = contract.chapterId?.trim();
  if (contractChapterId && contractChapterId !== chapterId) {
    throw new Error("The chapter contract does not match the continuation target chapter.");
  }
  return ChapterContractSchema.parse({ ...contract, chapterId });
};

const toExecutionInput = (
  input: ContinuationRunInput,
  projectPath: string,
  chapterId: string,
  contract: ChapterContract,
  runId: string
): ContinuationRunInput => ({
  ...input,
  projectPath,
  chapterId,
  contract,
  runId,
  instruction: input.instruction?.trim() ?? ""
});

const updateRun = (
  run: ContinuationRun,
  patch: Partial<Omit<ContinuationRun, "checkpoint" | "updatedAt">> & {
    checkpoint?: Partial<ContinuationRunCheckpoint>;
  }
): ContinuationRun => {
  const now = new Date().toISOString();
  const checkpoint = {
    ...run.checkpoint,
    ...patch.checkpoint,
    updatedAt: now
  } as ContinuationRunCheckpoint;
  const { checkpoint: _ignored, ...rest } = patch;
  return parseRun({ ...run, ...rest, checkpoint, updatedAt: now });
};

const buildContinuationMessages = (input: {
  chapterId: string;
  chapterTitle: string;
  contract: ChapterContract;
  instruction: string | undefined;
  evidencePack: EvidencePack;
}): ChatCompletionMessage[] => {
  const hardConstraintText = input.evidencePack.hardConstraints.length
    ? input.evidencePack.hardConstraints
        .map((fact) => `${fact.subjectId}.${fact.predicate}=${JSON.stringify(fact.objectValue)}`)
        .join("; ")
    : "（无额外锁定正典）";
  const system = [
    "You are the InkForge long-form continuation novelist.",
    "Write only the requested Chinese novel prose. Do not output analysis, outlines, labels, markdown fences, or explanations.",
    "The chapter contract and author-locked canon are hard constraints. Never contradict, silently retcon, or omit them.",
    "Treat every excerpt in the evidence pack as source evidence: preserve its facts, chronology, character state, and terminology; do not invent an unsupported backstory.",
    "Use the style exemplars as a voice baseline (rhythm, paragraphing, viewpoint, dialogue habits), while producing original text rather than copying passages.",
    `Hard canon constraints: ${hardConstraintText}`
  ].join("\n");
  const user = [
    `Chapter: ${input.chapterId} ${input.chapterTitle}`,
    `Author instruction: ${input.instruction?.trim() || "Continue naturally from the current chapter state."}`,
    "Return the continuation draft only.",
    "## Evidence pack",
    renderEvidencePack(input.evidencePack),
    "## Contract (must satisfy every mustHappen/requiredBeat and avoid every forbidden item)",
    JSON.stringify(input.contract, null, 2)
  ].join("\n\n");
  return [
    { role: "system", content: system },
    { role: "user", content: user }
  ];
};

const extractDraft = (completion: AgentCompletionResult): string => completion.message.content?.trim() ?? "";

const normalizeUsage = (completion: AgentCompletionResult, model?: string): ContinuationUsage | undefined => {
  const usage = completion.usage;
  if (!usage && !model) return undefined;
  return {
    promptTokens: usage?.prompt_tokens,
    completionTokens: usage?.completion_tokens,
    totalTokens: usage?.total_tokens,
    model
  };
};

const appendDraft = (current: string, draft: string): string => {
  const base = current.trimEnd();
  return base ? `${base}\n\n${draft.trim()}\n` : `${draft.trim()}\n`;
};

const parseRun = (value: unknown): ContinuationRun => {
  if (!value || typeof value !== "object") throw new Error("Invalid continuation run record.");
  const raw = value as Partial<ContinuationRun>;
  if (raw.schemaVersion !== 1 || !raw.id || !raw.projectPath || !raw.chapterId || !raw.checkpoint) {
    throw new Error("Invalid continuation run record.");
  }
  if (!continuationStatuses.has(raw.status as ContinuationRunStatus)) {
    throw new Error("Invalid continuation run status.");
  }
  if (!continuationPhases.has(raw.checkpoint.phase as ContinuationRunPhase) || !raw.checkpoint.updatedAt) {
    throw new Error("Invalid continuation run checkpoint.");
  }
  return {
    ...raw,
    schemaVersion: 1,
    contract: ChapterContractSchema.parse(raw.contract),
    evidencePack: raw.evidencePack ? EvidencePackSchema.parse(raw.evidencePack) : undefined,
    checkpoint: {
      phase: raw.checkpoint.phase,
      updatedAt: raw.checkpoint.updatedAt,
      message: raw.checkpoint.message
    },
    status: raw.status ?? "failed",
    instruction: raw.instruction ?? "",
    createdAt: raw.createdAt ?? raw.updatedAt ?? new Date().toISOString(),
    updatedAt: raw.updatedAt ?? raw.createdAt ?? new Date().toISOString()
  } as ContinuationRun;
};

const continuationStatuses = new Set<ContinuationRunStatus>([
  "queued",
  "running",
  "completed",
  "blocked",
  "failed",
  "cancelled"
]);
const continuationPhases = new Set<ContinuationRunPhase>([
  "created",
  "evidence-compiled",
  "generating",
  "draft-generated",
  "branch-created",
  "validated",
  "completed",
  "blocked",
  "failed",
  "cancelled"
]);

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const isMissingFile = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT";

class ContinuationCancelledError extends Error {
  constructor() {
    super("Continuation run cancelled by the author.");
    this.name = "ContinuationCancelledError";
  }
}

const isCancelledError = (error: unknown): boolean => error instanceof ContinuationCancelledError;
