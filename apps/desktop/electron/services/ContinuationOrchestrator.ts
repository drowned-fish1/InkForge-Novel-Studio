import { ContinuationRunStore } from "./ContinuationRunStore.js";
import { createHash, randomUUID } from "node:crypto";
import { buildWriterMessages, prepareWriterRequest, type WriterRequestV1 } from "@inkforge/prompt-engine";
import path from "node:path";
import { ChapterContractSchema, EvidencePackSchema, type ChapterContract, type EvidencePack } from "@inkforge/schemas";
import { completionBudget, type ProviderStatus, type ChatCompletionMessage } from "@inkforge/ai-provider";
import { AiProviderService, type AgentCompletionInput, type AgentCompletionResult } from "./AiProviderService.js";
import { BranchService } from "./BranchService.js";
import { CanonStore } from "./CanonStore.js";
import { ContextCompiler } from "./ContextCompiler.js";
import { LogicReviewService, LogicReviewIntegrityError, type LogicReviewResult } from "./LogicReviewService.js";
import { WorkspaceService } from "./WorkspaceService.js";
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
  | "editing"
  | "verifying"
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
  writerRequest?: WriterRequestV1;
  writerMessages?: ChatCompletionMessage[];
  originalDraft?: string;
  logicReview?: LogicReviewResult;
  logicReviewEnabled?: boolean;
  allowCompression?: boolean;
  updateProjectData?: boolean;
  appliedAt?: string;
  snapshotId?: string;
  postAcceptWarning?: string;
  baseContentHash?: string;
  writerTelemetry?: AgentCompletionResult["telemetry"];
  metrics?: { durationMs: number; originalParagraphRetention: number; estimatedCost?: number };
  createdAt: string;
  updatedAt: string;
}

export interface ContinuationRunInput {
  allowCompression?: boolean;
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
  logicReview?: boolean;
  updateProjectData?: boolean;
  yolo?: boolean;
}

export interface ContinuationRetryInput {
  allowCompression?: boolean;
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
  getStatus?(): Promise<ProviderStatus>;
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
  branches?: Pick<BranchService, "create"> & Partial<Pick<BranchService, "apply">>;
  compiler?: Pick<ContextCompiler, "compile">;
  validator?: Pick<ContinuationValidator, "validate">;
  styles?: Pick<StyleProfileService, "load" | "evaluateText">;
}

/**
 * Coordinates the long-form continuation pipeline.  Every externally visible
 * stage is persisted before the next one begins.  Generated prose is always
 * placed in a StoryBranch; YOLO may apply a validated branch with a backup.
 */
export class ContinuationOrchestrator {
  private readonly files: FileRepository;
  private readonly projects: ProjectService;
  /** Constructed lazily so list/get can be used by a headless recovery process. */
  private provider?: ContinuationProvider;
  private readonly branches: Pick<BranchService, "create"> & Partial<Pick<BranchService, "apply">>;
  private readonly compiler: Pick<ContextCompiler, "compile">;
  private readonly validator: Pick<ContinuationValidator, "validate">;
  private readonly styles: Pick<StyleProfileService, "load" | "evaluateText">;
  private readonly controls = new Map<string, { cancelled: boolean; requestId?: string }>();
  private readonly store: ContinuationRunStore<ContinuationRun>;

  constructor(dependencies: ContinuationOrchestratorDependencies = {}) {
    this.files = dependencies.files ?? new FileRepository();
    this.projects = dependencies.projects ?? new ProjectService(this.files);
    this.store = new ContinuationRunStore(this.files, parseRun);
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
    return this.store.get(projectPath, runId);
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
      logicReviewEnabled: input.logicReview !== false,
      allowCompression: input.allowCompression === true,
      updateProjectData: input.updateProjectData === true,
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
      originalDraft: undefined,
      logicReview: undefined,
      writerRequest: undefined,
      writerMessages: undefined,
      writerTelemetry: undefined,
      metrics: undefined,
      appliedAt: undefined,
      snapshotId: undefined,
      postAcceptWarning: undefined,
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
      logicReview: previous.logicReviewEnabled,
      allowCompression: retryOptions.allowCompression ?? previous.allowCompression,
      updateProjectData: previous.updateProjectData,
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
      const { chapterTitle, currentContent } = await this.readChapter(input.projectPath, input.chapterId);
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

      if ((await this.readChapter(input.projectPath, input.chapterId)).currentContent !== currentContent)
        throw new Error("上下文编译时正文已变化，请重新生成。");
      const status = await this.getProvider().getStatus?.();
      let inputBudget = input.tokenBudget;
      if (status) {
        const writer = completionBudget(status, input.useEditorModel ? "reviewer" : "writer", input.maxOutputTokens);
        const limits = [inputBudget, writer.inputTokens];
        if (input.logicReview !== false) {
          const reviewer = completionBudget(status, "reviewer", 12000);
          if (reviewer.inputTokens !== undefined) limits.push(reviewer.inputTokens - writer.outputTokens - 512);
        }
        const known = limits.filter((limit): limit is number => limit !== undefined);
        inputBudget = known.length ? Math.min(...known) : undefined;
      }
      const writerRequest: WriterRequestV1 = prepareWriterRequest(
        {
          schemaVersion: "inkforge.writer.v1",
          task: "continue_scene",
          storyPosition: {
            chapterId: input.chapterId,
            sceneId: `${run.id}-scene`,
            sourceCutoff: `${input.chapterId}:${currentContent.length}`
          },
          chapterContract: input.contract,
          sceneContract: {
            goal: input.contract.mustHappen.join("；") || input.contract.title || chapterTitle,
            pov: input.contract.pov,
            styleConstraints: []
          },
          evidencePack,
          recentText: currentContent.slice(-3_600),
          authorInstruction: input.instruction?.trim() || "承接前文继续本场景。",
          outputConstraints: { proseOnly: true, preserveNames: true }
        },
        inputBudget
      );
      current = updateRun(current, { evidencePack: writerRequest.evidencePack });
      const writerMessages = buildWriterMessages(writerRequest);
      current = updateRun(current, {
        writerRequest,
        writerMessages,
        baseContentHash: createHash("sha256").update(currentContent).digest("hex")
      });
      current = updateRun(current, { checkpoint: { phase: "generating" } });
      await this.upsert(input.projectPath, current);
      const completion = await this.getProvider().runAgentCompletion(
        {
          providerRole: input.useEditorModel ? "reviewer" : "writer",
          requestId: control.requestId,
          messages: writerMessages,
          maxOutputTokens: input.maxOutputTokens,
          modelOverride: input.modelOverride,
          toolChoice: "none"
        },
        undefined
      );
      this.assertNotCancelled(run.id);
      let draft = extractDraft(completion);
      if (!draft) throw new Error("Provider returned an empty continuation draft.");
      const usage = normalizeUsage(completion, completion.model);
      current = updateRun(current, {
        status: "running",
        draft,
        originalDraft: draft,
        writerTelemetry: completion.telemetry,
        usage,
        model: completion.model,
        checkpoint: { phase: "draft-generated" }
      });
      await this.upsert(input.projectPath, current);
      this.assertNotCancelled(run.id);

      let logicReview: LogicReviewResult | undefined;
      if (input.logicReview !== false) {
        logicReview = await new LogicReviewService(this.getProvider()).review({
          draft,
          allowCompression: input.allowCompression,
          recentText: writerRequest.recentText,
          instruction: input.instruction ?? "",
          evidencePack: writerRequest.evidencePack,
          requestId: control.requestId,
          assertActive: () => this.assertNotCancelled(run.id),
          onCheckpoint: async (phase, edit) => {
            current = updateRun(current, {
              checkpoint: { phase },
              ...(edit ? { draft: (edit as { revisedText: string }).revisedText } : {})
            });
            await this.upsert(input.projectPath, current);
          }
        });
        draft = logicReview.revisedText;
        const calls = logicReview.calls;
        current = updateRun(current, {
          draft,
          logicReview,
          usage: {
            ...usage,
            promptTokens:
              usage?.promptTokens !== undefined && calls.every((call) => call.usage?.prompt_tokens !== undefined)
                ? usage.promptTokens + calls.reduce((sum, call) => sum + call.usage!.prompt_tokens!, 0)
                : undefined,
            completionTokens:
              usage?.completionTokens !== undefined &&
              calls.every((call) => call.usage?.completion_tokens !== undefined)
                ? usage.completionTokens + calls.reduce((sum, call) => sum + call.usage!.completion_tokens!, 0)
                : undefined,
            totalTokens:
              usage?.totalTokens !== undefined && calls.every((call) => call.usage?.total_tokens !== undefined)
                ? usage.totalTokens + calls.reduce((sum, call) => sum + call.usage!.total_tokens!, 0)
                : undefined
          }
        });
        await this.upsert(input.projectPath, current);
      }

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
        updateProjectData: input.updateProjectData,
        expectedBaseContent: currentContent,
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
      if (logicReview && !logicReview.canApply) {
        validation.canApply = false;
        validation.hardFailures += 1;
        validation.findings.push({
          id: "logic-review-unresolved",
          severity: "hard",
          category: "canon",
          title: "逻辑复核未通过",
          detail:
            [
              ...logicReview.edit.unresolvedIssues,
              ...logicReview.verification.unresolvedIssues,
              ...logicReview.verification.findings
                .filter((finding) => finding.severity === "hard")
                .map((finding) => finding.detail)
            ].join("；") || "独立复核未明确通过。"
        });
      }
      current = updateRun(current, {
        status: validation.canApply ? "completed" : "blocked",
        metrics: {
          durationMs: Date.now() - Date.parse(run.checkpoint.updatedAt),
          originalParagraphRetention: (() => {
            const paragraphs = (current.originalDraft ?? draft).split(/\n\s*\n/u).filter((value) => value.trim());
            return paragraphs.length
              ? paragraphs.filter((paragraph) => draft.includes(paragraph)).length / paragraphs.length
              : 0;
          })(),
          estimatedCost: (() => {
            const costs = [
              completion.telemetry?.estimatedCost,
              ...(logicReview?.calls.map((call) => call.telemetry?.estimatedCost) ?? [])
            ];
            return costs.every((cost) => cost !== undefined)
              ? costs.reduce<number>((sum, cost) => sum + cost!, 0)
              : undefined;
          })()
        },
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
      if (input.yolo && validation.canApply) {
        this.assertNotCancelled(run.id);
        const latest = await this.readChapter(input.projectPath, input.chapterId);
        if (createHash("sha256").update(latest.currentContent).digest("hex") !== current.baseContentHash)
          throw new Error("正文已变化，YOLO 写入已停止；分支保留供复核。");
        if (!this.branches.apply) throw new Error("当前分支服务不支持自动应用。");
        const snapshot = await new WorkspaceService(this.files).createBackup(
          input.projectPath,
          "manual",
          `YOLO续写 ${run.id}`
        );
        current = updateRun(current, { snapshotId: snapshot.id });
        await this.upsert(input.projectPath, current);
        const applied = await this.branches.apply(input.projectPath, branch.id, true);
        current = updateRun(current, {
          appliedAt: new Date().toISOString(),
          postAcceptWarning:
            [
              applied.indexingError && `索引更新失败：${applied.indexingError}`,
              applied.dataUpdateError && `资料更新失败：${applied.dataUpdateError}`
            ]
              .filter(Boolean)
              .join("；") || undefined
        });
        await this.upsert(input.projectPath, current);
      }
      return this.toResult(current);
    } catch (error) {
      const cancelled = isCancelledError(error) || this.isCancelled(run.id);
      current = updateRun(current, {
        status: cancelled ? "cancelled" : error instanceof LogicReviewIntegrityError ? "blocked" : "failed",
        error: cancelled ? "Continuation run cancelled by the author." : errorMessage(error),
        checkpoint: {
          phase: cancelled ? "cancelled" : error instanceof LogicReviewIntegrityError ? "blocked" : "failed",
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

  private readRuns(projectPath: string) {
    return this.store.list(projectPath);
  }
  private upsert(projectPath: string, run: ContinuationRun) {
    return this.store.save(projectPath, run);
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
  "editing",
  "verifying",
  "branch-created",
  "validated",
  "completed",
  "blocked",
  "failed",
  "cancelled"
]);

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

class ContinuationCancelledError extends Error {
  constructor() {
    super("Continuation run cancelled by the author.");
    this.name = "ContinuationCancelledError";
  }
}

const isCancelledError = (error: unknown): boolean => error instanceof ContinuationCancelledError;
