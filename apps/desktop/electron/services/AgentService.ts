import {
  PipelineRunner,
  WritingSessionManager,
  getPipelinePreset,
  pipelinePresets,
  type PipelineData,
  type PipelineRunState,
  type PipelineStep,
  type PipelineStepInput,
  type PipelineStepResult,
  type WritingScene,
  type WritingSessionState
} from "@inkforge/agent-engine";
import type {
  AiTaskResult,
  PipelinePresetSummary,
  PipelineRunStatus,
  PipelineRunView,
  PipelineStartInput,
  PipelineStepView,
  WritingSessionCommandInput
} from "../types.js";
import { AiProviderService } from "./AiProviderService.js";
import { FileRepository } from "./FileRepository.js";
import { LibraryService } from "./LibraryService.js";
import { ProjectService } from "./ProjectService.js";
import { StoryStateService } from "./StoryStateService.js";
import { SummaryService } from "./SummaryService.js";

const demoChainLabel = "演示 / Mock";
const demoPipelineNotice = `${demoChainLabel}: 未提供项目章节上下文时，流水线只运行 agent-engine 本地模拟步骤。`;
const demoWritingNotice = `${demoChainLabel}: 当前自主写作只生成本地模拟草稿，不调用真实 AI provider 或生产链路。`;
const realPipelineNotice = "真实链路：构建上下文 -> 调用 AI provider -> 本地检查 -> 摘要 -> 作者确认 -> 写入章节。";

interface PipelineContext {
  projectPath: string;
  chapterId: string;
  chapterTitle: string;
  chapterGoal: string;
  chapterFile: string;
  content: string;
  recentText: string;
  style: string;
  characters: string[];
  worldFacts: string[];
}

export class AgentService {
  private pipelineRunner?: PipelineRunner;
  private pipelineState?: PipelineRunState;
  private pipelineView?: PipelineRunView;
  private writingManager?: WritingSessionManager;
  private decisionAccepted = false;

  constructor(
    private readonly files = new FileRepository(),
    private readonly projects = new ProjectService(files),
    private readonly library = new LibraryService(files),
    private readonly story = new StoryStateService(files, projects),
    private readonly ai = new AiProviderService(),
    private readonly summaries = new SummaryService(files)
  ) {}

  listPipelinePresets(): PipelinePresetSummary[] {
    return Object.values(pipelinePresets).map((preset) => ({
      id: preset.id,
      name: preset.name,
      description: preset.description,
      autoCommit: preset.autoCommit,
      stopOnError: preset.stopOnError,
      steps: [
        ...preset.steps.map((step) => ({
          id: step.id,
          title: step.title ?? step.id
        })),
        { id: "confirm", title: "Confirm write" },
        { id: "apply", title: "Apply to chapter" }
      ]
    }));
  }

  async startPipeline(input: PipelineStartInput): Promise<PipelineRunView> {
    const preset = getPipelinePreset(input.presetId as keyof typeof pipelinePresets);
    const isRealRun = Boolean(input.projectPath && input.chapterId);
    const logs = [
      isRealRun ? realPipelineNotice : demoPipelineNotice,
      `${isRealRun ? "Real" : demoChainLabel} pipeline ${preset.name} queued.`,
      input.chapterId ? `Chapter scope: ${input.chapterId}` : "Scope: current project"
    ];
    const runnerSteps = isRealRun
      ? this.createRealPipelineSteps(preset.steps, logs)
      : this.decorateDemoPipelineSteps(preset.steps, logs);

    this.pipelineRunner = new PipelineRunner(runnerSteps);
    this.pipelineView = {
      id: `pipe_${Date.now()}`,
      presetId: preset.id,
      status: "running",
      startedAt: new Date().toISOString(),
      steps: runnerSteps.map((step, index) => ({
        id: step.id,
        title: step.title ?? step.id,
        status: index === 0 ? "running" : "pending"
      })),
      logs,
      outputs: {}
    };
    this.pipelineState = await this.pipelineRunner.run({
      autoCommit: true,
      stopOnError: preset.stopOnError,
      initialData: {
        projectPath: input.projectPath,
        chapterId: input.chapterId,
        presetId: preset.id,
        realRun: isRealRun
      }
    });
    return this.renderPipelineView();
  }

  async confirmPipelineStep(): Promise<PipelineRunView> {
    this.assertPipeline();
    this.pipelineView?.logs.push("Author confirmation accepted; continuing pipeline.");
    this.pipelineState = await this.pipelineRunner!.continue(this.pipelineState!, { autoCommit: true });
    return this.renderPipelineView();
  }

  pausePipeline(): PipelineRunView {
    this.assertPipeline();
    if (this.pipelineView?.status === "running") {
      this.pipelineView.status = "paused";
      this.pipelineView.logs.push("Pipeline paused by user.");
    }
    return this.renderPipelineView("paused");
  }

  cancelPipeline(): PipelineRunView {
    this.assertPipeline();
    if (this.pipelineView) {
      this.pipelineView.status = "cancelled";
      this.pipelineView.completedAt = new Date().toISOString();
      this.pipelineView.logs.push("Pipeline cancelled by user.");
    }
    return this.renderPipelineView("cancelled");
  }

  async runWritingCommand(input: WritingSessionCommandInput): Promise<WritingSessionState> {
    if (input.command === "start") {
      const scenes = input.scenes?.length ? input.scenes : fallbackWritingScenes();
      this.decisionAccepted = false;
      this.writingManager = this.createWritingManager(input.sessionId ?? `writing_${Date.now()}`, scenes);
      this.writingManager.createCheckpoint(`${demoChainLabel} before autonomous writing`);
      return this.writingManager.runAutoLoop();
    }

    this.assertWritingSession();
    if (input.command === "pause") {
      return this.writingManager!.pause();
    }
    if (input.command === "resume") {
      this.writingManager!.resume();
      return this.writingManager!.runAutoLoop();
    }
    if (input.command === "stop") {
      const state = this.writingManager!.pause();
      return { ...state, status: "done", pendingDecision: undefined };
    }
    if (input.command === "checkpoint") {
      this.writingManager!.createCheckpoint(input.checkpointLabel?.trim() || `${demoChainLabel} manual checkpoint`);
      return this.writingManager!.getState();
    }
    if (input.command === "rollback") {
      if (!input.checkpointId) {
        throw new Error("checkpointId is required for rollback.");
      }
      return this.writingManager!.rollback(input.checkpointId);
    }
    if (input.command === "resolveDecision") {
      this.decisionAccepted = true;
      this.writingManager!.resume();
      return this.writingManager!.runAutoLoop();
    }

    return this.writingManager!.getState();
  }

  private createRealPipelineSteps(presetSteps: PipelineStep[], logs: string[]): PipelineStep[] {
    const steps = presetSteps.map((step) => ({
      id: step.id,
      title: step.title,
      inputFrom: step.inputFrom,
      run: async ({ data, previous }: PipelineStepInput): Promise<PipelineStepResult> => {
        logs.push(`Running ${step.title ?? step.id}.`);
        const result = await this.runRealPipelineStep(step.id, data, previous?.output);
        logs.push(`${step.title ?? step.id} completed.`);
        return result;
      }
    }));
    return [
      ...steps,
      {
        id: "confirm",
        title: "Confirm write",
        run: () => ({
          id: "confirm",
          status: "paused",
          output: { pending: true },
          message: "Draft and summary are ready. Confirm to write them into the chapter."
        })
      },
      {
        id: "apply",
        title: "Apply to chapter",
        run: async ({ data }) => {
          logs.push("Waiting for author confirmation before writing files.");
          const draft = textFromData(data.revise) || textFromData(data["draft-scenes"]) || textFromData(data.draft);
          if (!draft.trim()) {
            logs.push("No draft output was produced; confirmation completed without chapter changes.");
            return {
              id: "apply",
              output: {
                chapterId: String(data.chapterId ?? ""),
                appliedAt: new Date().toISOString(),
                changed: false
              },
              message: "No draft output was produced; no chapter changes were written."
            };
          }
          await this.applyPipelineDraft(data, draft);
          logs.push("Draft appended to chapter and summary saved.");
          return {
            id: "apply",
            output: {
              chapterId: String(data.chapterId ?? ""),
              appliedAt: new Date().toISOString()
            },
            message: "Draft written to chapter after confirmation."
          };
        }
      }
    ];
  }

  private async runRealPipelineStep(id: string, data: PipelineData, previousOutput: unknown) {
    if (id === "context") {
      const context = await this.buildPipelineContext(data);
      return {
        id,
        output: context,
        data: contextToData(context),
        message: `Context built for ${context.chapterTitle}.`
      };
    }

    const context = await this.ensureContext(data);
    if (id === "scene-plan") {
      return {
        id,
        output: {
          title: context.chapterTitle,
          goal: context.chapterGoal,
          beats: [
            "Continue from the current ending.",
            "Escalate the chapter conflict.",
            "Close with a hook that fits the outline."
          ]
        },
        message: "Scene plan generated from chapter context."
      };
    }
    if (id === "draft" || id === "draft-scenes") {
      const draft = await this.ai.runTask({
        projectPath: context.projectPath,
        task: "continue",
        instruction:
          "Generate Markdown prose that can be appended to the current chapter. Continue from the recent text and honor the chapter goal.",
        chapterTitle: context.chapterTitle,
        chapterGoal: context.chapterGoal,
        recentText: context.recentText,
        characters: context.characters,
        worldFacts: context.worldFacts,
        style: context.style
      });
      return {
        id,
        output: draft,
        data: { pendingDraft: draft.text },
        message: summarizeText(draft.text)
      };
    }
    if (
      id === "review" ||
      id === "character-check" ||
      id === "term-check" ||
      id === "clue-check" ||
      id === "timeline-check" ||
      id === "world-check" ||
      id === "consistency" ||
      id === "final-check" ||
      id === "export-check"
    ) {
      const issues = await this.story.inspect(context.projectPath);
      return {
        id,
        output: {
          issues,
          draftSnippet: summarizeText(textFromData(previousOutput) || String(data.pendingDraft ?? ""))
        },
        message: issues.length ? `${issues.length} local story checks reported.` : "Local story checks passed."
      };
    }
    if (id === "revise" || id === "polish" || id === "typo") {
      const draft = textFromData(previousOutput) || String(data.pendingDraft ?? "");
      if (!draft.trim()) {
        return { id, output: previousOutput, message: "No draft revision needed." };
      }
      const revised =
        id === "revise"
          ? draft
          : (
              await this.ai.runTask({
                projectPath: context.projectPath,
                task: id === "polish" ? "polish" : "typo",
                instruction: "Keep the same plot content. Return only the revised Markdown prose.",
                chapterTitle: context.chapterTitle,
                chapterGoal: context.chapterGoal,
                recentText: draft,
                characters: context.characters,
                worldFacts: context.worldFacts,
                style: context.style
              })
            ).text;
      return {
        id,
        output: revised,
        data: { pendingDraft: revised },
        message: summarizeText(revised)
      };
    }
    if (id === "summary") {
      const draft = String(data.pendingDraft ?? "");
      const summary = await this.ai.runTask({
        projectPath: context.projectPath,
        task: "summary",
        instruction: "Summarize the pending draft and current chapter state for future context.",
        chapterTitle: context.chapterTitle,
        chapterGoal: context.chapterGoal,
        recentText: [context.content, draft].filter(Boolean).join("\n\n").slice(-12000),
        characters: context.characters,
        worldFacts: context.worldFacts,
        style: context.style
      });
      return {
        id,
        output: summary,
        data: { pendingSummary: summary },
        message: summarizeText(summary.text)
      };
    }

    return {
      id,
      output: previousOutput ?? data,
      message: `${id} completed.`
    };
  }

  private async buildPipelineContext(data: PipelineData): Promise<PipelineContext> {
    const projectPath = String(data.projectPath ?? "");
    const chapterId = String(data.chapterId ?? "");
    if (!projectPath || !chapterId) {
      throw new Error("Pipeline requires projectPath and chapterId for a real run.");
    }
    const project = await this.projects.openProject(projectPath);
    const chapter = project.outline.volumes.flatMap((volume) => volume.chapters).find((item) => item.id === chapterId);
    if (!chapter) {
      throw new Error(`Chapter ${chapterId} was not found in the current outline.`);
    }
    const content = await this.files
      .readText(this.files.assertInsideProject(projectPath, chapter.file))
      .catch(() => "");
    const [characters, worldEntries] = await Promise.all([
      this.library.listCharacters(projectPath).catch(() => []),
      this.library.listWorldEntries(projectPath).catch(() => [])
    ]);
    return {
      projectPath,
      chapterId,
      chapterTitle: chapter.title,
      chapterGoal: chapter.goal || chapter.hook || project.outline.mainConflict || project.outline.premise,
      chapterFile: chapter.file,
      content,
      recentText: content.slice(-6000),
      style: project.meta.writingPreferences.style,
      characters: characters
        .slice(0, 12)
        .map(
          (item) =>
            `${item.name}：${item.profile.identity || item.role}；${item.profile.motivation || item.currentState.arc}`
        ),
      worldFacts: worldEntries
        .slice(0, 10)
        .map((item) => `${item.title}：${item.summary || item.content.slice(0, 120)}`)
    };
  }

  private async ensureContext(data: PipelineData): Promise<PipelineContext> {
    if (
      typeof data.projectPath === "string" &&
      typeof data.chapterId === "string" &&
      typeof data.chapterFile === "string"
    ) {
      return {
        projectPath: data.projectPath,
        chapterId: data.chapterId,
        chapterTitle: String(data.chapterTitle ?? ""),
        chapterGoal: String(data.chapterGoal ?? ""),
        chapterFile: data.chapterFile,
        content: String(data.content ?? ""),
        recentText: String(data.recentText ?? ""),
        style: String(data.style ?? ""),
        characters: arrayOfStrings(data.characters),
        worldFacts: arrayOfStrings(data.worldFacts)
      };
    }
    return this.buildPipelineContext(data);
  }

  private async applyPipelineDraft(data: PipelineData, draft: string): Promise<void> {
    const context = await this.ensureContext(data);
    const nextContent = [context.content.trimEnd(), draft.trim()].filter(Boolean).join("\n\n");
    await this.files.writeTextAtomic(
      this.files.assertInsideProject(context.projectPath, context.chapterFile),
      `${nextContent}\n`
    );
    const summary = data.pendingSummary as AiTaskResult | undefined;
    if (summary?.text) {
      await this.summaries.saveChapterSummary({
        projectPath: context.projectPath,
        chapterId: context.chapterId,
        chapterTitle: context.chapterTitle,
        result: summary
      });
    }
  }

  private decorateDemoPipelineSteps(steps: PipelineStep[], logs: string[]): PipelineStep[] {
    return steps.map((step) => ({
      ...step,
      run: async (input) => {
        logs.push(`${demoChainLabel} running ${step.title ?? step.id}.`);
        await delay(120);
        const result = await step.run(input);
        logs.push(`${demoChainLabel} ${step.title ?? step.id} completed.`);
        return {
          ...result,
          output: result.output ?? {
            ok: true,
            source: "electron-demo-mock",
            stepId: step.id,
            completedAt: new Date().toISOString()
          },
          message: markDemoSummary(result.message ?? `${step.title ?? step.id} completed`)
        };
      }
    }));
  }

  private renderPipelineView(forcedStatus?: PipelineRunStatus): PipelineRunView {
    this.assertPipeline();
    const base = this.pipelineView!;
    const state = this.pipelineState;
    const completedIds = new Set(state?.results.map((result) => result.id) ?? []);
    const resultById = new Map(state?.results.map((result) => [result.id, result]) ?? []);
    const status = forcedStatus ?? normalizePipelineStatus(state?.status ?? base.status);
    const currentStepId = state?.pendingStep?.id ?? state?.results.at(-1)?.id ?? base.currentStepId;
    const steps: PipelineStepView[] = base.steps.map((step) => {
      const result = resultById.get(step.id);
      if (result) {
        return {
          ...step,
          status: result.status === "paused" ? "paused" : "completed",
          outputSummary: result.message ?? summarizeOutput(result.output)
        };
      }
      if (status === "cancelled") {
        return { ...step, status: completedIds.has(step.id) ? "completed" : "skipped" };
      }
      if (state?.pendingStep?.id === step.id) {
        return { ...step, status: "paused" };
      }
      if (state?.error && state.currentStepIndex === base.steps.findIndex((item) => item.id === step.id)) {
        return { ...step, status: "failed", error: state.error.message };
      }
      return { ...step, status: status === "running" && step.id === currentStepId ? "running" : "pending" };
    });

    this.pipelineView = {
      ...base,
      status,
      currentStepId,
      pendingStepId: state?.pendingStep?.id,
      completedAt: ["completed", "failed", "cancelled"].includes(status)
        ? (base.completedAt ?? new Date().toISOString())
        : undefined,
      steps,
      outputs: state?.data ?? base.outputs,
      error: state?.error?.message
    };
    return structuredClone(this.pipelineView);
  }

  private createWritingManager(sessionId: string, scenes: WritingScene[]): WritingSessionManager {
    return new WritingSessionManager(WritingSessionManager.create(sessionId, scenes), {
      maxAutoRevisions: 0,
      writer: ({ scene, previousDrafts }) => {
        if (!this.decisionAccepted && previousDrafts.length === 0) {
          return `${demoWritingNotice}\n\n草稿片段：${scene.title}\n\nMock 人物抵达现场，但关键目标尚未定稿，需要作者确认推进方向。`;
        }
        return [
          demoWritingNotice,
          "",
          `## ${scene.title}`,
          "",
          `${scene.goal || "场景目标"}正在推进。`,
          scene.expectedCharacters?.length
            ? `出场人物：${scene.expectedCharacters.join("、")}。`
            : "人物动机保持清晰。",
          scene.requiredTerms?.length ? `关键设定：${scene.requiredTerms.join("、")}。` : "设定未出现冲突。",
          "本段为 Mock 演示输出，以一个新的钩子收束，方便接入下一场。"
        ].join("\n");
      }
    });
  }

  private assertPipeline(): void {
    if (!this.pipelineRunner || !this.pipelineView) {
      throw new Error("No active pipeline run.");
    }
  }

  private assertWritingSession(): void {
    if (!this.writingManager) {
      throw new Error("No active writing session.");
    }
  }
}

const contextToData = (context: PipelineContext): PipelineData => ({
  projectPath: context.projectPath,
  chapterId: context.chapterId,
  chapterTitle: context.chapterTitle,
  chapterGoal: context.chapterGoal,
  chapterFile: context.chapterFile,
  content: context.content,
  recentText: context.recentText,
  style: context.style,
  characters: context.characters,
  worldFacts: context.worldFacts
});

const normalizePipelineStatus = (status: PipelineRunStatus | PipelineRunState["status"]): PipelineRunStatus =>
  status === "idle" ||
  status === "running" ||
  status === "paused" ||
  status === "failed" ||
  status === "completed" ||
  status === "cancelled"
    ? status
    : "idle";

const markDemoSummary = (value: string): string =>
  value.includes(demoChainLabel) ? value : `${demoChainLabel}: ${value}`;

const textFromData = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object" && "text" in value) {
    return String((value as { text?: unknown }).text ?? "");
  }
  return "";
};

const summarizeText = (value: string): string => value.trim().replace(/\s+/g, " ").slice(0, 140);

const summarizeOutput = (value: unknown): string => {
  const text = textFromData(value);
  if (text) {
    return summarizeText(text);
  }
  if (!value) {
    return "";
  }
  try {
    return JSON.stringify(value).slice(0, 120);
  } catch {
    return String(value).slice(0, 120);
  }
};

const arrayOfStrings = (value: unknown): string[] => (Array.isArray(value) ? value.map((item) => String(item)) : []);

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const fallbackWritingScenes = (): WritingScene[] => [
  {
    id: "scene_1",
    title: "Opening beat",
    goal: "Confirm the protagonist's immediate choice"
  }
];
