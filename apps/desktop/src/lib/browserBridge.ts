import { defaultProviderConfig } from "@inkforge/schemas";
import { createDefaultPromptTemplate, parsePromptTemplate, promptTemplateFileName } from "@inkforge/prompt-engine";
import type {
  AiTaskInput,
  AiTaskResult,
  ExportInput,
  PipelinePresetSummary,
  PipelineRunView,
  PipelineStartInput,
  ProviderConfigInput,
  ProviderStatus,
  WritingSessionCommandInput,
  WritingSessionState
} from "@/types/app";
import type { InkforgeApi } from "../../electron/types";
import { hasAuthMaterial, maskApiKey, runBrowserAiTask } from "@/lib/browserAiProvider";
import { browserLibraryService } from "@/lib/browserLibraryService";
import { exportManuscriptInBrowser } from "@/lib/browserManuscriptExport";
import { browserProjectService } from "@/lib/browserProjectService";
import {
  getProjectRecord,
  readProviderStorage,
  writeProviderStorage,
  type BrowserProviderStorage
} from "@/lib/browserStorage";

const providerStatusFromStorage = (provider: BrowserProviderStorage): ProviderStatus => ({
  configured: hasAuthMaterial(provider.authMode, provider.apiKey),
  providerId: provider.providerId,
  displayName: provider.displayName,
  baseUrl: provider.baseUrl,
  model: provider.model,
  authMode: provider.authMode,
  maskedKey: maskApiKey(provider.apiKey),
  updatedAt: provider.updatedAt || undefined
});

const mockChainLabel = "演示 / Mock";
const mockPipelineNotice = `${mockChainLabel}：当前流水线仅运行浏览器本地模拟步骤，不调用真实 AI provider 或生产链路。`;
const mockWritingNotice = `${mockChainLabel}：当前自主写作仅生成浏览器本地模拟草稿，不调用真实 AI provider 或生产链路。`;

const mockPipelinePresets: PipelinePresetSummary[] = [
  {
    id: "quick-continue",
    name: "Quick Continue",
    description: `${mockPipelineNotice} Build context, draft the next passage, and run a lightweight self review.`,
    autoCommit: true,
    stopOnError: true,
    steps: [
      { id: "context", title: "Build context" },
      { id: "draft", title: "Draft continuation" },
      { id: "review", title: "Self review" }
    ]
  },
  {
    id: "full-chapter",
    name: "Full Chapter",
    description: `${mockPipelineNotice} Plan scenes, draft each scene, self review, revise, and summarize the chapter.`,
    autoCommit: true,
    stopOnError: true,
    steps: [
      { id: "context", title: "Build context" },
      { id: "scene-plan", title: "Plan scenes" },
      { id: "draft-scenes", title: "Draft scenes" },
      { id: "review", title: "Self review" },
      { id: "revise", title: "Auto revise" },
      { id: "summary", title: "Summarize chapter" }
    ]
  },
  {
    id: "chapter-revise",
    name: "Chapter Revise",
    description: `${mockPipelineNotice} Review an existing chapter and produce a focused revision pass.`,
    autoCommit: false,
    stopOnError: true,
    steps: [
      { id: "review", title: "Review chapter" },
      { id: "revise", title: "Revise chapter" },
      { id: "final-check", title: "Final check" }
    ]
  }
];

let browserPipelineRun: PipelineRunView | undefined;
let browserWritingSession: WritingSessionState | undefined;

const estimateBrowserTokens = (text: string): number => Math.max(1, Math.round(text.length / 2));

const createPausedPipelineRun = (input: PipelineStartInput): PipelineRunView => {
  const preset = mockPipelinePresets.find((item) => item.id === input.presetId) ?? mockPipelinePresets[0];
  const first = preset.steps[0];
  const second = preset.steps[1];
  return {
    id: `browser_pipe_${Date.now()}`,
    presetId: preset.id,
    status: second ? "paused" : "completed",
    currentStepId: first.id,
    pendingStepId: second?.id,
    startedAt: new Date().toISOString(),
    completedAt: second ? undefined : new Date().toISOString(),
    steps: preset.steps.map((step, index) => ({
      id: step.id,
      title: step.title,
      status: index === 0 ? "completed" : index === 1 ? "paused" : "pending",
      outputSummary: index === 0 ? `${mockChainLabel} context packet ready.` : undefined
    })),
    logs: [
      `${mockPipelineNotice}`,
      `${mockChainLabel} pipeline ${preset.name} started.`,
      `${mockChainLabel} build context completed.`,
      second
        ? `${mockChainLabel} awaiting confirmation before ${second.title}.`
        : `${mockChainLabel} pipeline completed.`
    ],
    outputs: {
      context: {
        projectPath: input.projectPath,
        chapterId: input.chapterId,
        source: "browser-demo-mock"
      }
    }
  };
};

const completeBrowserPipeline = (): PipelineRunView => {
  if (!browserPipelineRun) {
    throw new Error("No active pipeline run.");
  }
  browserPipelineRun = {
    ...browserPipelineRun,
    status: "completed",
    completedAt: new Date().toISOString(),
    pendingStepId: undefined,
    steps: browserPipelineRun.steps.map((step) => ({
      ...step,
      status: "completed",
      outputSummary: step.outputSummary ?? `${step.title} completed with ${mockChainLabel} output.`
    })),
    logs: [
      ...browserPipelineRun.logs,
      `${mockChainLabel} manual confirmation accepted.`,
      `${mockChainLabel} remaining mock steps completed.`
    ],
    outputs: {
      ...browserPipelineRun.outputs,
      draft: `${mockChainLabel} draft output`,
      review: `${mockChainLabel} review passed`
    }
  };
  return structuredClone(browserPipelineRun);
};

const checkpointSnapshot = (state: WritingSessionState) => {
  const { checkpoints: _checkpoints, ...snapshot } = state;
  return structuredClone(snapshot);
};

export const browserBridge: InkforgeApi = {
  async setTheme(): Promise<void> {
    return undefined;
  },
  ...browserProjectService,
  ...browserLibraryService,
  async exportManuscript(input: ExportInput): Promise<string> {
    return exportManuscriptInBrowser(input);
  },
  async providerStatus(): Promise<ProviderStatus> {
    return providerStatusFromStorage(readProviderStorage());
  },
  async saveProviderConfig(input: ProviderConfigInput): Promise<ProviderStatus> {
    const existing = readProviderStorage();
    const nextApiKey = input.apiKey?.trim() || existing.apiKey;
    if (input.authMode !== "none" && !nextApiKey) {
      throw new Error("需要先填写 API Key，或选择无 Key 模式。");
    }
    const provider: BrowserProviderStorage = {
      ...input,
      providerId: input.providerId.trim() || defaultProviderConfig.providerId,
      displayName: input.displayName.trim() || defaultProviderConfig.displayName,
      baseUrl: input.baseUrl.trim().replace(/\/+$/, ""),
      model: input.model.trim(),
      apiKey: input.authMode === "none" ? "" : nextApiKey,
      updatedAt: new Date().toISOString()
    };
    writeProviderStorage(provider);
    return providerStatusFromStorage(provider);
  },
  async runAiTask(input: AiTaskInput, signal?: AbortSignal, onDelta?: (chunk: string) => void): Promise<AiTaskResult> {
    const provider = readProviderStorage();
    if (!hasAuthMaterial(provider.authMode, provider.apiKey)) {
      throw new Error("Provider 尚未配置。");
    }
    const record = getProjectRecord(input.projectPath);
    const template = record.prompts[promptTemplateFileName(input.task)]
      ? parsePromptTemplate(record.prompts[promptTemplateFileName(input.task)])
      : createDefaultPromptTemplate(input.task);
    const result = await runBrowserAiTask(input, provider, template, signal);
    onDelta?.(result.text);
    return result;
  },
  async cancelAiTask(): Promise<void> {
    return undefined;
  },
  async cancelPlanningAi(): Promise<void> {
    return undefined;
  },
  async listPipelinePresets(): Promise<PipelinePresetSummary[]> {
    return structuredClone(mockPipelinePresets);
  },
  async startPipeline(input: PipelineStartInput): Promise<PipelineRunView> {
    browserPipelineRun = createPausedPipelineRun(input);
    return structuredClone(browserPipelineRun);
  },
  async confirmPipelineStep(): Promise<PipelineRunView> {
    return completeBrowserPipeline();
  },
  async pausePipeline(): Promise<PipelineRunView> {
    if (!browserPipelineRun) {
      throw new Error("No active pipeline run.");
    }
    browserPipelineRun = {
      ...browserPipelineRun,
      status: "paused",
      logs: [...browserPipelineRun.logs, `${mockChainLabel} pipeline paused by user.`]
    };
    return structuredClone(browserPipelineRun);
  },
  async cancelPipeline(): Promise<PipelineRunView> {
    if (!browserPipelineRun) {
      throw new Error("No active pipeline run.");
    }
    browserPipelineRun = {
      ...browserPipelineRun,
      status: "cancelled",
      completedAt: new Date().toISOString(),
      steps: browserPipelineRun.steps.map((step) =>
        step.status === "completed" ? step : { ...step, status: "skipped" }
      ),
      logs: [...browserPipelineRun.logs, `${mockChainLabel} pipeline cancelled by user.`]
    };
    return structuredClone(browserPipelineRun);
  },
  async runWritingSessionCommand(input: WritingSessionCommandInput): Promise<WritingSessionState> {
    if (input.command === "start") {
      const scenes = input.scenes?.length ? input.scenes : [{ id: "scene_1", title: "Opening", goal: "Start writing" }];
      const sessionId = input.sessionId ?? `browser_writing_${Date.now()}`;
      const now = new Date().toISOString();
      const review = {
        passed: false,
        score: 72,
        findings: [
          {
            category: "scene-goal" as const,
            severity: "warning" as const,
            message: "需要确认场景目标是否按当前方向推进。"
          }
        ],
        categoryScores: {
          "scene-goal": 72,
          "character-voice": 86,
          terms: 90,
          "canon-conflict": 100
        },
        summary: `${mockChainLabel} 需要一次作者决策。`
      };
      browserWritingSession = {
        id: sessionId,
        status: "awaiting_decision",
        scenes,
        currentSceneIndex: 0,
        drafts: [
          {
            sceneId: scenes[0].id,
            text: `${mockWritingNotice}\n\n草稿片段：${scenes[0].title}\n\n浏览器 Mock 已生成第一版，但建议先确认关键推进方向。`,
            revisionCount: 0,
            review
          }
        ],
        checkpoints: [
          {
            id: "checkpoint_1",
            createdAt: now,
            label: `${mockChainLabel} before autonomous writing`,
            state: {
              id: sessionId,
              status: "planning",
              scenes,
              currentSceneIndex: 0,
              drafts: [],
              pendingDecision: undefined,
              lastReview: undefined
            }
          }
        ],
        pendingDecision: `${mockChainLabel}: Scene ${scenes[0].title} needs a direction decision.`,
        lastReview: review
      };
      return structuredClone(browserWritingSession);
    }

    if (!browserWritingSession) {
      throw new Error("No active writing session.");
    }
    if (input.command === "pause") {
      browserWritingSession = { ...browserWritingSession, status: "paused" };
    } else if (input.command === "resume" || input.command === "resolveDecision") {
      const drafts = browserWritingSession.scenes.map((scene, index) => ({
        sceneId: scene.id,
        text: `${mockWritingNotice}\n\n## ${scene.title}\n\n${scene.goal || "场景目标"}正在推进。\n\n本场输出来自 browser mock，自主写作演示流程已继续。`,
        revisionCount: index === 0 ? 1 : 0,
        review: {
          passed: true,
          score: 92,
          findings: [],
          categoryScores: {
            "scene-goal": 92,
            "character-voice": 90,
            terms: 92,
            "canon-conflict": 100
          },
          summary: `${mockChainLabel} self review passed.`
        }
      }));
      browserWritingSession = {
        ...browserWritingSession,
        status: "done",
        currentSceneIndex: browserWritingSession.scenes.length,
        drafts,
        pendingDecision: undefined,
        lastReview: drafts.at(-1)?.review
      };
    } else if (input.command === "stop") {
      browserWritingSession = { ...browserWritingSession, status: "done", pendingDecision: undefined };
    } else if (input.command === "checkpoint") {
      browserWritingSession = {
        ...browserWritingSession,
        checkpoints: [
          ...browserWritingSession.checkpoints,
          {
            id: `checkpoint_${browserWritingSession.checkpoints.length + 1}`,
            createdAt: new Date().toISOString(),
            label: input.checkpointLabel?.trim() || `${mockChainLabel} manual checkpoint`,
            state: checkpointSnapshot(browserWritingSession)
          }
        ]
      };
    } else if (input.command === "rollback") {
      const checkpoint = browserWritingSession.checkpoints.find((item) => item.id === input.checkpointId);
      if (!checkpoint) {
        throw new Error("Checkpoint not found.");
      }
      browserWritingSession = {
        ...structuredClone(checkpoint.state),
        checkpoints: browserWritingSession.checkpoints
      };
    }
    void estimateBrowserTokens(browserWritingSession.drafts.map((draft) => draft.text).join("\n"));
    return structuredClone(browserWritingSession);
  }
};

const electronBridge = window.inkforge as Partial<InkforgeApi> | undefined;

export const bridge: InkforgeApi = new Proxy(browserBridge, {
  get(target, key: keyof InkforgeApi) {
    const browserValue = target[key];
    if (!electronBridge) {
      return browserValue;
    }
    const electronValue = electronBridge?.[key];
    if (typeof electronValue === "function") {
      return electronValue.bind(electronBridge);
    }
    if (typeof browserValue === "function") {
      return () =>
        Promise.reject(
          new Error(
            `Electron bridge method "${String(key)}" is unavailable. Browser demo fallback is disabled while preload is present.`
          )
        );
    }
    return browserValue;
  }
}) as InkforgeApi;
