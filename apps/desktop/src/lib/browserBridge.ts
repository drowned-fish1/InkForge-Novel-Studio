import {
  defaultProviderConfig,
  defaultAgentMembers,
  BeatBoardSchema,
  compileBeatBoardToInk,
  compileBeatBoardToTwee,
  dedupeSimulationBranches,
  SimulationDocumentSchema,
  SimulationScenarioSchema,
  type BatchRun,
  type BackupSnapshot,
  type BeatBoard,
  type BranchDiffLine,
  type AgentExtensionConfig,
  type QualityReport,
  type SimulationBranch,
  type SimulationDocument,
  type SimulationRun,
  type SimulationScenario,
  type StoryBranch,
  type WritingWorkspace
} from "@inkforge/schemas";
import { createDefaultPromptTemplate, parsePromptTemplate, promptTemplateFileName } from "@inkforge/prompt-engine";
import type {
  AgentChangeResolutionInput,
  AgentDataResolutionInput,
  AgentChatInput,
  AgentChatSession,
  AgentSessionCommandInput,
  AgentRunEvent,
  AgentRunTrace,
  AiTaskInput,
  AiTaskResult,
  ExportInput,
  PlayableExportInput,
  SimulationRunEvent,
  SimulationRunInput,
  PipelinePresetSummary,
  PipelineRunView,
  PipelineStartInput,
  ProviderConfigInput,
  ProviderStatus,
  WritingSessionCommandInput,
  WritingSessionState
} from "@/types/app";
import type { ScenePlan } from "@inkforge/schemas";
import type { InkforgeApi } from "../../electron/types";
import { hasAuthMaterial, maskApiKey, runBrowserAiTask } from "@/lib/browserAiProvider";
import { browserLibraryService } from "@/lib/browserLibraryService";
import { exportManuscriptInBrowser } from "@/lib/browserManuscriptExport";
import { browserProjectService } from "@/lib/browserProjectService";
import { invokeWithRendererAbort } from "@/lib/rendererAbort";
import {
  getProjectRecord,
  readProviderStorage,
  saveProjectRecord,
  writeProviderStorage,
  type BrowserProviderStorage
} from "@/lib/browserStorage";

const providerStatusFromStorage = (provider: BrowserProviderStorage): ProviderStatus => ({
  configured: hasAuthMaterial(provider.authMode, provider.apiKey),
  providerId: provider.providerId,
  displayName: provider.displayName,
  baseUrl: provider.baseUrl,
  model: provider.model,
  editorModel: provider.editorModel,
  authMode: provider.authMode,
  maskedKey: maskApiKey(provider.apiKey),
  updatedAt: provider.updatedAt || undefined
});

const mockChainLabel = "演示 / Mock";
const mockPipelineNotice = `${mockChainLabel}：当前流水线仅运行浏览器本地模拟步骤，不调用真实 AI provider 或生产链路。`;
const mockWritingNotice = `${mockChainLabel}：当前自主写作仅生成浏览器本地模拟草稿，不调用真实 AI provider 或生产链路。`;

const mockPipelinePresets: PipelinePresetSummary[] = [
  {
    id: "literary-polish",
    name: "文学精修 Agent 组",
    description: `${mockPipelineNotice} 粗稿、感官精修与编辑修剪三阶段对照。`,
    autoCommit: false,
    stopOnError: true,
    steps: [
      { id: "context", title: "资料员 · 锁定事实" },
      { id: "rough-draft", title: "粗稿 Agent · 铺齐节点" },
      { id: "sensory-pass", title: "感官 Agent · 逐段精修" },
      { id: "editor-pass", title: "编辑 Agent · 节奏修剪" }
    ]
  },
  {
    id: "quick-continue",
    name: "快速续写协作组",
    description: `${mockPipelineNotice} 读取上下文、续写下一段，并由审稿 Agent 做轻量检查。`,
    autoCommit: true,
    stopOnError: true,
    steps: [
      { id: "context", title: "资料员 · 构建上下文" },
      { id: "draft", title: "正文 Agent · 续写" },
      { id: "review", title: "审稿 Agent · 自检" }
    ]
  },
  {
    id: "full-chapter",
    name: "完整章节 Agent 组",
    description: `${mockPipelineNotice} 规划场景、逐场起草、审稿修订，并沉淀章节记忆。`,
    autoCommit: true,
    stopOnError: true,
    steps: [
      { id: "context", title: "资料员 · 构建上下文" },
      { id: "scene-plan", title: "策划 Agent · 场景规划" },
      { id: "draft-scenes", title: "正文 Agent · 分场起草" },
      { id: "review", title: "审稿 Agent · 章节检查" },
      { id: "revise", title: "修订 Agent · 定向改写" },
      { id: "summary", title: "记忆 Agent · 章节摘要" }
    ]
  },
  {
    id: "chapter-revise",
    name: "章节修订 Agent 组",
    description: `${mockPipelineNotice} 检查已有章节，执行定向修订并完成终检。`,
    autoCommit: false,
    stopOnError: true,
    steps: [
      { id: "review", title: "审稿 Agent · 诊断章节" },
      { id: "revise", title: "修订 Agent · 执行改写" },
      { id: "final-check", title: "审稿 Agent · 最终检查" }
    ]
  }
];

let browserPipelineRun: PipelineRunView | undefined;
let browserWritingSession: WritingSessionState | undefined;
let browserAgentSession: AgentChatSession | undefined;
let browserAgentTraces: AgentRunTrace[] = [];
let browserQualityReports: QualityReport[] = [];
let browserBranches: StoryBranch[] = [];
let browserBatchRuns: BatchRun[] = [];
const browserBackups = new Map<string, BackupSnapshot[]>();
const browserSimulations = new Map<string, SimulationDocument[]>();
const browserWritingWorkspaces = new Map<string, WritingWorkspace>();
const browserAgentExtensions = new Map<string, AgentExtensionConfig>();

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
  const literaryOutputs =
    browserPipelineRun.presetId === "literary-polish"
      ? {
          roughDraft:
            "林烬推门进站，先确认父亲留下的储物柜编号。广播响起，检票员认出那张旧车票。灯灭后，他发现柜门已经打开。",
          sensoryDraft:
            "林烬推门进站，鞋底先被潮湿的水磨石黏了一下。广播里电流的沙响盖过了储物柜号码；检票员捏住旧车票时，纸边在他指腹上刮出一道白痕。灯灭后，柜门轴发出一声很轻的回弹。",
          editorDraft:
            "林烬推门进站，鞋底被潮湿的水磨石黏了一下。广播的电流声盖过储物柜号码。检票员捏住旧车票，纸边在他指腹刮出白痕。\n\n灯灭后，柜门轴轻轻回弹。门已经开了。"
        }
      : {};
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
      review: `${mockChainLabel} review passed`,
      ...literaryOutputs
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
  async listBackups(projectPath) {
    return structuredClone(browserBackups.get(projectPath) ?? []);
  },
  async createBackup(projectPath, label) {
    const snapshot: BackupSnapshot = {
      id: `browser-backup-${Date.now()}`,
      createdAt: new Date().toISOString(),
      reason: "manual",
      label: label ?? "",
      fileCount: 8,
      size: 16_384
    };
    browserBackups.set(projectPath, [snapshot, ...(browserBackups.get(projectPath) ?? [])]);
    return structuredClone(snapshot);
  },
  async restoreBackup(projectPath) {
    return structuredClone(getProjectRecord(projectPath).summary);
  },
  async deleteBackup(projectPath, snapshotId) {
    browserBackups.set(
      projectPath,
      (browserBackups.get(projectPath) ?? []).filter((item) => item.id !== snapshotId)
    );
  },
  async loadWritingWorkspace(projectPath) {
    return structuredClone(
      browserWritingWorkspaces.get(projectPath) ?? { annotations: [], bookmarks: [], sessions: [] }
    );
  },
  async saveWritingWorkspace(projectPath, workspace) {
    browserWritingWorkspaces.set(projectPath, structuredClone(workspace));
    return structuredClone(workspace);
  },
  async loadAgentExtensions(projectPath) {
    return structuredClone(
      browserAgentExtensions.get(projectPath) ?? {
        promptPresets: [],
        toolProfiles: [],
        customTools: [],
        members: defaultAgentMembers
      }
    );
  },
  async saveAgentExtensions(projectPath, config) {
    browserAgentExtensions.set(projectPath, structuredClone(config));
    return structuredClone(config);
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
      editorModel: input.editorModel?.trim() || undefined,
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
  async skipPipelineStep(): Promise<PipelineRunView> {
    if (!browserPipelineRun) {
      throw new Error("No active pipeline run.");
    }
    const pendingId = browserPipelineRun.pendingStepId;
    browserPipelineRun = {
      ...browserPipelineRun,
      status: "paused",
      steps: browserPipelineRun.steps.map((step) => (step.id === pendingId ? { ...step, status: "skipped" } : step)),
      logs: [...browserPipelineRun.logs, `${mockChainLabel} pending stage skipped.`]
    };
    return structuredClone(browserPipelineRun);
  },
  async retryPipelineStep(): Promise<PipelineRunView> {
    if (!browserPipelineRun) {
      throw new Error("No active pipeline run.");
    }
    browserPipelineRun = {
      ...browserPipelineRun,
      status: "paused",
      error: undefined,
      logs: [...browserPipelineRun.logs, `${mockChainLabel} failed stage retried.`]
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
  },
  async loadAgentChat(_projectPath: string, chapterId: string): Promise<AgentChatSession> {
    if (!browserAgentSession || browserAgentSession.chapterId !== chapterId) {
      const now = new Date().toISOString();
      browserAgentSession = {
        schemaVersion: "0.1.0",
        id: `browser_agent_${chapterId}`,
        projectId: "browser-project",
        chapterId,
        title: "当前章节 · 创作对话",
        messages: [
          {
            id: `message_${Date.now()}`,
            role: "assistant",
            content: "我已接入当前章节。浏览器预览会演示完整交互，桌面版会调用真实 Agent 工具。",
            createdAt: now
          }
        ],
        proposals: [],
        dataProposals: [],
        collaborationRuns: [],
        branches: [{ id: "main", title: "主会话", createdAt: now }],
        activeBranchId: "main",
        updatedAt: now
      };
    }
    return structuredClone(browserAgentSession);
  },
  async runAgentChat(
    input: AgentChatInput,
    signal?: AbortSignal,
    onEvent?: (event: AgentRunEvent) => void
  ): Promise<AgentChatSession> {
    const session = await this.loadAgentChat(input.projectPath, input.chapterId);
    const now = new Date().toISOString();
    const branchId = input.branchId ?? session.activeBranchId ?? "main";
    session.activeBranchId = branchId;
    const selectedMembers = defaultAgentMembers.filter((member) => input.targetAgentIds?.includes(member.id));
    const agentIdentity =
      selectedMembers.length === 1
        ? { agentId: selectedMembers[0].id, agentName: `@${selectedMembers[0].handle}` }
        : selectedMembers.length > 1
          ? { agentId: "creative-room", agentName: "@创作组" }
          : {};
    const confirmedPlan =
      input.mode === "execute-plan" && input.planMessageId
        ? session.messages.find(
            (item) => item.id === input.planMessageId && item.kind === "plan" && item.planStatus === "pending"
          )
        : undefined;
    if (input.mode === "execute-plan" && !confirmedPlan) {
      throw new Error("找不到可执行的计划，或该计划已被执行。");
    }
    if (confirmedPlan) {
      confirmedPlan.planStatus = "executing";
    }
    const traceId = `browser_trace_${Date.now()}`;
    const events: AgentRunEvent[] = [];
    const emit = (event: Omit<AgentRunEvent, "id" | "timestamp">) => {
      const next: AgentRunEvent = {
        id: `browser_event_${Date.now()}_${events.length}`,
        timestamp: new Date().toISOString(),
        ...event
      };
      events.push(next);
      onEvent?.(next);
    };
    emit({ type: "run_started", label: "Agent 开始处理", detail: "" });
    await browserDelay(60, signal);
    emit({
      type: "context_prepared",
      label: "上下文预算已完成",
      detail: "1180/2600 tokens · 4 条语义命中"
    });
    emit({ type: "model_started", turn: 0, label: "模型推理 · 第 1 轮", detail: "" });
    if (input.mode !== "plan") {
      emit({
        type: "tool_started",
        turn: 0,
        toolName: "get_chapter_context",
        label: "读取章节上下文",
        detail: ""
      });
      await browserDelay(90, signal);
      emit({
        type: "tool_completed",
        turn: 0,
        toolName: "get_chapter_context",
        label: "读取章节上下文",
        detail: "已读取当前章节目标与最近正文",
        durationMs: 90
      });
      emit({ type: "model_started", turn: 1, label: "模型推理 · 第 2 轮", detail: "" });
    }
    session.messages.push({
      id: `message_user_${Date.now()}`,
      role: "user",
      content: input.message,
      createdAt: now,
      branchId
    });
    let collaborationRunId: string | undefined;
    if (selectedMembers.length > 1 && input.mode !== "plan") {
      collaborationRunId = `browser_collaboration_${Date.now()}`;
      const coordinator = selectedMembers.find((member) => member.id === "director") ?? selectedMembers[0];
      const tasks = selectedMembers.map((member, index) => ({
        id: `browser_task_${member.id}_${Date.now()}`,
        title: member.id === coordinator.id ? "协调并验收结果" : `${member.name}独立处理`,
        instruction: `按“${member.role}”职责处理作者请求。`,
        assignedTo: member.id,
        createdBy: coordinator.id,
        status: "approved" as const,
        dependencies: index ? [] : [],
        allowedTools: member.allowedTools,
        attempt: 1,
        maxAttempts: 2,
        result: member.id === coordinator.id ? "已综合各成员意见。" : `${member.name} 已完成独立分析并交接。`,
        feedback: "已通过协调验收。",
        createdAt: now,
        updatedAt: now
      }));
      session.collaborationRuns.push({
        id: collaborationRunId,
        request: input.message,
        coordinatorId: coordinator.id,
        participantIds: selectedMembers.map((member) => member.id),
        status: "completed",
        tasks,
        messages: selectedMembers
          .filter((member) => member.id !== coordinator.id)
          .map((member) => ({
            id: `browser_handoff_${member.id}_${Date.now()}`,
            taskId: tasks.find((task) => task.assignedTo === member.id)?.id,
            fromAgentId: member.id,
            toAgentIds: [coordinator.id],
            kind: "handoff" as const,
            content: `${member.name} 已提交独立结果。`,
            createdAt: now
          })),
        agents: selectedMembers.map((member) => ({
          agentId: member.id,
          status: "idle",
          allowedTools: member.allowedTools,
          memory: [`本轮完成：${input.message}`],
          transcript: []
        })),
        createdAt: now,
        updatedAt: now
      });
    }
    if (input.mode !== "plan") {
      session.messages.push({
        id: `message_tool_${Date.now()}`,
        role: "tool",
        content: "已读取当前章节目标与最近正文",
        createdAt: now,
        toolName: "get_chapter_context",
        toolStatus: "completed",
        branchId
      });
    }
    const assistantText =
      input.mode === "plan"
        ? "1. 读取当前章节与长期记忆。\n2. 检查人物动机和既有伏笔。\n3. 生成可逐块审阅的正文提案。\n4. 等待作者确认后写入。"
        : input.writingApproach === "compare" && /(续写|改写|写一|正文|场景)/.test(input.message)
          ? "## A｜稳定版\n\n夜色漫过窗沿，门外的脚步声停了。主角收好信件，起身查看门外。\n\n## B｜灵感版\n\n门外的脚步声停下时，他先看了一眼电脑右下角的时间。离交稿还有十一分钟。那封信仍压在掌心，他没有拆——门缝下多出了一道影子，可走廊的灯明明坏了三天。"
          : /(续写|改写|写一|正文|场景)/.test(input.message)
            ? "我根据当前结尾准备了一段续写提案。请先审阅，确认后才会写入章节。"
            : "我已完成资料读取。桌面版中，你可以让我继续调用故事圣经、语义检索和一致性检查工具。";
    emit({
      type: "reasoning_delta",
      turn: input.mode === "plan" ? 0 : 1,
      label: "模型思考",
      detail:
        input.mode === "plan" ? "先把目标拆成可确认的步骤，暂不调用任何工具。" : "先读取章节，再判断是否需要生成提案。"
    });
    for (const chunk of assistantText.match(/.{1,12}/gu) ?? [assistantText]) {
      await browserDelay(25, signal);
      emit({ type: "text_delta", turn: input.mode === "plan" ? 0 : 1, label: "模型输出", detail: chunk });
    }
    if (
      input.mode !== "plan" &&
      input.writingApproach !== "compare" &&
      /(续写|改写|写一|正文|场景)/.test(input.message)
    ) {
      const proposalId = `proposal_${Date.now()}`;
      session.proposals.push({
        id: proposalId,
        chapterId: input.chapterId,
        mode: "patch",
        content: "",
        explanation: "浏览器预览提案，用于演示作者确认后再写入的安全流程。",
        blocks: [
          {
            id: `patch_${Date.now()}`,
            operation: "insert_after",
            originalText: "在这里开始写作。",
            proposedText: "\n\n夜色越过窗沿时，门外的脚步声忽然停了。主角没有回头，只把那封尚未拆开的信压进掌心。",
            explanation: "承接当前结尾，引入新的外部动静。",
            status: "pending"
          }
        ],
        baseContentHash: "browser-preview",
        status: "pending",
        createdAt: now
      });
      session.messages.push({
        id: `message_assistant_${Date.now()}`,
        role: "assistant",
        ...agentIdentity,
        content: assistantText,
        reasoning: "根据章节目标判断需要先读取正文，再生成受作者确认保护的提案。",
        createdAt: now,
        branchId
      });
    } else {
      session.messages.push({
        id: `message_assistant_${Date.now()}`,
        role: "assistant",
        ...agentIdentity,
        kind: input.mode === "plan" ? "plan" : "message",
        planStatus: input.mode === "plan" ? "pending" : undefined,
        content: assistantText,
        reasoning:
          input.mode === "plan"
            ? "先把目标拆成可确认的步骤，暂不调用任何工具。"
            : "先识别任务类型，再决定是否需要调用写作工具。",
        createdAt: now,
        branchId
      });
    }
    emit({
      type: "model_completed",
      turn: 1,
      label: "模型响应完成",
      detail: "",
      durationMs: 420,
      usage: { promptTokens: 216, completionTokens: 74, totalTokens: 290 }
    });
    emit({
      type: "run_completed",
      label: "本轮完成",
      detail: "",
      durationMs: 640,
      usage: { promptTokens: 216, completionTokens: 74, totalTokens: 290 }
    });
    const trace: AgentRunTrace = {
      schemaVersion: "0.1.0",
      id: traceId,
      requestId: input.requestId ?? traceId,
      chapterId: input.chapterId,
      userMessage: input.message,
      status: "completed",
      model: "gpt-4.1-mini",
      mode: input.mode ?? "direct",
      branchId,
      replayOf: input.replayOfTraceId,
      startedAt: now,
      completedAt: new Date().toISOString(),
      durationMs: 640,
      usage: { promptTokens: 216, completionTokens: 74, totalTokens: 290 },
      context: {
        tokenBudget: 2600,
        estimatedTokens: 1180,
        semanticHits: 4,
        recentMemories: 2,
        compressedMemories: 6,
        omittedItems: 0
      },
      events,
      error: ""
    };
    browserAgentTraces = [trace, ...browserAgentTraces].slice(0, 20);
    if (confirmedPlan) {
      confirmedPlan.planStatus = "completed";
    }
    session.updatedAt = now;
    browserAgentSession = session;
    return structuredClone(session);
  },
  async cancelAgentChat(): Promise<void> {
    return undefined;
  },
  async listAgentTraces(_projectPath: string, chapterId: string): Promise<AgentRunTrace[]> {
    return structuredClone(browserAgentTraces.filter((trace) => trace.chapterId === chapterId));
  },
  async resolveAgentChange(input: AgentChangeResolutionInput): Promise<AgentChatSession> {
    const session = await this.loadAgentChat(input.projectPath, input.chapterId);
    const proposal = session.proposals.find((item) => item.id === input.proposalId);
    if (!proposal) {
      throw new Error("找不到修改提案。");
    }
    if (input.action === "accept-block" || input.action === "reject-block") {
      const block = proposal.blocks.find((item) => item.id === input.blockId);
      if (!block) {
        throw new Error("找不到修改块。");
      }
      block.status = input.action === "accept-block" ? "accepted" : "rejected";
    } else if (input.action === "rollback") {
      proposal.status = "rolled_back";
    } else {
      proposal.status = input.action === "apply" ? "applied" : "rejected";
      if (input.action === "apply") {
        proposal.snapshotId = "browser-history-preview.md";
      }
    }
    proposal.resolvedAt = new Date().toISOString();
    if (!input.action.endsWith("-block")) {
      session.messages.push({
        id: `message_resolution_${Date.now()}`,
        role: "assistant",
        content:
          input.action === "apply"
            ? "演示提案已确认，并创建了写入前快照。"
            : input.action === "rollback"
              ? "已恢复到演示写入前版本。"
              : "演示提案已放弃。",
        createdAt: proposal.resolvedAt
      });
    }
    session.updatedAt = proposal.resolvedAt;
    browserAgentSession = session;
    return structuredClone(session);
  },
  async resolveAgentDataChange(input: AgentDataResolutionInput): Promise<AgentChatSession> {
    const session = await this.loadAgentChat(input.projectPath, input.chapterId);
    const proposal = session.dataProposals.find((item) => item.id === input.proposalId);
    if (!proposal) {
      throw new Error("找不到资料修改提案。");
    }
    proposal.status = input.action === "apply" ? "applied" : "rejected";
    proposal.resolvedAt = new Date().toISOString();
    session.updatedAt = proposal.resolvedAt;
    browserAgentSession = session;
    return structuredClone(session);
  },
  async manageAgentSession(input: AgentSessionCommandInput): Promise<AgentChatSession> {
    const session = await this.loadAgentChat(input.projectPath, input.chapterId);
    const branches = session.branches ?? [{ id: "main", title: "主会话", createdAt: session.updatedAt }];
    if (input.action === "create-branch") {
      const branch = {
        id: `browser_branch_${Date.now()}`,
        title: input.title?.trim() || `分支 ${branches.length}`,
        parentBranchId: session.activeBranchId ?? "main",
        forkedFromMessageId: session.messages.at(-1)?.id,
        createdAt: new Date().toISOString()
      };
      session.branches = [...branches, branch];
      session.activeBranchId = branch.id;
    } else if (input.action === "select-branch" && input.branchId) {
      session.activeBranchId = input.branchId;
    } else if (input.action === "toggle-favorite" && input.messageId) {
      const item = session.messages.find((message) => message.id === input.messageId);
      if (item) {
        item.favorite = !item.favorite;
      }
    }
    browserAgentSession = session;
    return structuredClone(session);
  },
  async listScenePlans(projectPath: string, chapterId: string): Promise<ScenePlan[]> {
    try {
      return JSON.parse(localStorage.getItem(`inkforge.scenePlans.${projectPath}.${chapterId}`) ?? "[]") as ScenePlan[];
    } catch {
      return [];
    }
  },
  async saveScenePlans(projectPath: string, chapterId: string, scenes: ScenePlan[]): Promise<ScenePlan[]> {
    localStorage.setItem(`inkforge.scenePlans.${projectPath}.${chapterId}`, JSON.stringify(scenes));
    return structuredClone(scenes);
  },
  async evaluateChapterQuality(projectPath, chapterId): Promise<QualityReport> {
    const record = getProjectRecord(projectPath);
    const chapter = record.summary.outline.volumes
      .flatMap((volume) => volume.chapters)
      .find((item) => item.id === chapterId);
    if (!chapter) {
      throw new Error("Chapter not found.");
    }
    const content = record.chapterBodies[chapter.file] ?? "";
    const wordCount = Math.max(0, content.replace(/\s/gu, "").length);
    const report: QualityReport = {
      schemaVersion: "0.1.0",
      id: `quality_${Date.now()}`,
      chapterId,
      chapterTitle: chapter.title,
      createdAt: new Date().toISOString(),
      fingerprint: `browser-${content.length}`,
      wordCount,
      overallScore: wordCount < 500 ? 78 : 91,
      dimensionScores: {
        continuity: 94,
        character: 89,
        pacing: wordCount < 500 ? 72 : 90,
        style: 92,
        repetition: 96,
        clue: 88
      },
      findings:
        wordCount < 500
          ? [
              {
                id: `finding_${Date.now()}`,
                dimension: "pacing",
                severity: "warning",
                title: "章节体量偏短",
                detail: `当前约 ${wordCount} 字，建议补足场景转折。`,
                evidence: "",
                suggestion: "补足目标、阻力与结果三个节拍。"
              }
            ]
          : []
    };
    browserQualityReports = [report, ...browserQualityReports];
    return structuredClone(report);
  },
  async listChapterQualityReports(_projectPath, chapterId): Promise<QualityReport[]> {
    return structuredClone(browserQualityReports.filter((report) => report.chapterId === chapterId));
  },
  async setChapterQualityBaseline(_projectPath, chapterId, reportId): Promise<QualityReport> {
    const report = browserQualityReports.find((item) => item.chapterId === chapterId && item.id === reportId);
    if (!report) {
      throw new Error("Quality report not found.");
    }
    return structuredClone(report);
  },
  async listStoryBranches(_projectPath, chapterId): Promise<StoryBranch[]> {
    return structuredClone(browserBranches.filter((branch) => !chapterId || branch.chapterId === chapterId));
  },
  async createStoryBranch(input): Promise<StoryBranch> {
    const record = getProjectRecord(input.projectPath);
    const chapter = record.summary.outline.volumes
      .flatMap((volume) => volume.chapters)
      .find((item) => item.id === input.chapterId);
    if (!chapter) {
      throw new Error("Chapter not found.");
    }
    const baseContent = record.chapterBodies[chapter.file] ?? "";
    const now = new Date().toISOString();
    const branch: StoryBranch = {
      schemaVersion: "0.1.0",
      id: `branch_${Date.now()}`,
      chapterId: input.chapterId,
      name: input.name,
      description: input.description ?? "",
      baseFingerprint: `browser-${baseContent.length}`,
      baseContent,
      content: input.content ?? baseContent,
      status: "draft",
      source: input.source ?? "manual",
      createdAt: now,
      updatedAt: now
    };
    browserBranches = [branch, ...browserBranches];
    return structuredClone(branch);
  },
  async saveStoryBranch(input): Promise<StoryBranch> {
    const branch = browserBranches.find((item) => item.id === input.branchId);
    if (!branch) {
      throw new Error("Story branch not found.");
    }
    Object.assign(branch, {
      name: input.name ?? branch.name,
      description: input.description ?? branch.description,
      content: input.content ?? branch.content,
      updatedAt: new Date().toISOString()
    });
    return structuredClone(branch);
  },
  async compareStoryBranch(projectPath, branchId): Promise<BranchDiffLine[]> {
    const branch = browserBranches.find((item) => item.id === branchId);
    if (!branch) {
      throw new Error("Story branch not found.");
    }
    const record = getProjectRecord(projectPath);
    const chapter = record.summary.outline.volumes
      .flatMap((volume) => volume.chapters)
      .find((item) => item.id === branch.chapterId);
    const current = chapter ? (record.chapterBodies[chapter.file] ?? "") : "";
    return browserLineDiff(current, branch.content);
  },
  async applyStoryBranch(projectPath, branchId): Promise<StoryBranch> {
    const branch = browserBranches.find((item) => item.id === branchId);
    if (!branch) {
      throw new Error("Story branch not found.");
    }
    const record = getProjectRecord(projectPath);
    const chapter = record.summary.outline.volumes
      .flatMap((volume) => volume.chapters)
      .find((item) => item.id === branch.chapterId);
    if (!chapter) {
      throw new Error("Chapter not found.");
    }
    record.chapterBodies[chapter.file] = branch.content;
    branch.status = "applied";
    branch.updatedAt = new Date().toISOString();
    saveProjectRecord(record);
    return structuredClone(branch);
  },
  async archiveStoryBranch(_projectPath, branchId): Promise<StoryBranch> {
    const branch = browserBranches.find((item) => item.id === branchId);
    if (!branch) {
      throw new Error("Story branch not found.");
    }
    branch.status = "archived";
    branch.updatedAt = new Date().toISOString();
    return structuredClone(branch);
  },
  async listBatchRuns(): Promise<BatchRun[]> {
    return structuredClone(browserBatchRuns);
  },
  async createBatchRun(input): Promise<BatchRun> {
    const record = getProjectRecord(input.projectPath);
    const chapters = record.summary.outline.volumes.flatMap((volume) => volume.chapters);
    const now = new Date().toISOString();
    const run: BatchRun = {
      schemaVersion: "0.1.0",
      id: `batch_${Date.now()}`,
      status: "draft",
      tasks: input.chapterIds.map((chapterId, index) => {
        const chapter = chapters.find((item) => item.id === chapterId);
        if (!chapter) {
          throw new Error("Chapter not found.");
        }
        return {
          id: `batch_task_${Date.now()}_${index}`,
          chapterId,
          chapterTitle: chapter.title,
          status: "queued",
          estimatedTokens: 1200,
          actualTokens: 0,
          error: ""
        };
      }),
      tokenBudget: input.tokenBudget,
      usedTokens: 0,
      checkpointEvery: input.checkpointEvery,
      completedSinceCheckpoint: 0,
      createdAt: now,
      updatedAt: now,
      logs: ["浏览器演示批次已创建；草稿只进入分支，不覆盖正文。"]
    };
    browserBatchRuns = [run, ...browserBatchRuns];
    return structuredClone(run);
  },
  async resumeBatchRun(projectPath, runId): Promise<BatchRun> {
    const run = browserBatchRuns.find((item) => item.id === runId);
    const task = run?.tasks.find((item) => item.status === "queued");
    if (!run || !task) {
      if (!run) throw new Error("Batch run not found.");
      return structuredClone(run);
    }
    const record = getProjectRecord(projectPath);
    const chapter = record.summary.outline.volumes
      .flatMap((volume) => volume.chapters)
      .find((item) => item.id === task.chapterId);
    const base = chapter ? (record.chapterBodies[chapter.file] ?? "") : "";
    const branch = await this.createStoryBranch({
      projectPath,
      chapterId: task.chapterId,
      name: "批量草稿 · 浏览器演示",
      content: `${base.trimEnd()}\n\n夜色压低了屋檐，新的脚步声在门外停住。\n`,
      source: "batch"
    });
    task.status = "completed";
    task.actualTokens = 238;
    task.branchId = branch.id;
    task.qualityScore = 88;
    run.usedTokens += task.actualTokens;
    run.completedSinceCheckpoint = 1;
    run.status = run.tasks.every((item) => item.status === "completed") ? "completed" : "paused";
    run.updatedAt = new Date().toISOString();
    run.logs.push(`${task.chapterTitle} 已生成分支草稿，抵达人工检查点。`);
    return structuredClone(run);
  },
  async cancelBatchRun(_projectPath, runId): Promise<BatchRun> {
    const run = browserBatchRuns.find((item) => item.id === runId);
    if (!run) throw new Error("Batch run not found.");
    run.status = "cancelled";
    run.tasks = run.tasks.map((task) => (task.status === "queued" ? { ...task, status: "cancelled" } : task));
    run.updatedAt = new Date().toISOString();
    return structuredClone(run);
  },
  async loadBeatBoard(projectPath: string): Promise<BeatBoard> {
    try {
      return BeatBoardSchema.parse(JSON.parse(localStorage.getItem(`inkforge.beatBoard.${projectPath}`) ?? "{}"));
    } catch {
      return BeatBoardSchema.parse({});
    }
  },
  async saveBeatBoard(projectPath: string, board: BeatBoard): Promise<BeatBoard> {
    const parsed = BeatBoardSchema.parse({ ...board, updatedAt: new Date().toISOString() });
    localStorage.setItem(`inkforge.beatBoard.${projectPath}`, JSON.stringify(parsed));
    return parsed;
  },
  async exportPlayable(input: PlayableExportInput): Promise<string | undefined> {
    const record = getProjectRecord(input.projectPath);
    const board = await this.loadBeatBoard(input.projectPath);
    const options = { title: record.summary.meta.title, author: record.summary.meta.author };
    const content =
      input.format === "twee" ? compileBeatBoardToTwee(board, options) : compileBeatBoardToInk(board, options);
    const fileName = `${record.summary.meta.title.trim().replace(/[<>:"/\\|?*\u0000-\u001F]/g, "") || "story"}.${input.format}`;
    const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.style.display = "none";
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    return fileName;
  },
  async listSimulations(projectPath: string): Promise<SimulationDocument[]> {
    return structuredClone(browserSimulations.get(projectPath) ?? []);
  },
  async saveSimulationScenario(projectPath: string, scenario: SimulationScenario): Promise<SimulationDocument> {
    const parsed = SimulationScenarioSchema.parse({
      ...scenario,
      createdAt: scenario.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    const documents = browserSimulations.get(projectPath) ?? [];
    const existing = documents.find((item) => item.scenario.id === parsed.id);
    const document = SimulationDocumentSchema.parse({ scenario: parsed, runs: existing?.runs ?? [] });
    browserSimulations.set(projectPath, [document, ...documents.filter((item) => item.scenario.id !== parsed.id)]);
    return structuredClone(document);
  },
  async runSimulation(
    input: SimulationRunInput,
    signal?: AbortSignal,
    onEvent?: (event: SimulationRunEvent) => void
  ): Promise<SimulationDocument> {
    const documents = browserSimulations.get(input.projectPath) ?? [];
    const document = documents.find((item) => item.scenario.id === input.scenarioId);
    if (!document) {
      throw new Error("找不到这个推演场景。");
    }
    const scenario = document.scenario;
    if (!scenario.participants.length) {
      throw new Error("场景还没有参与角色。");
    }
    const characters = await this.listCharacters(input.projectPath);
    const cast = scenario.participants.map((participant) => ({
      participant,
      name: characters.find((item) => item.id === participant.characterId)?.name ?? participant.characterId
    }));
    let eventCount = 0;
    const emit = (event: Omit<SimulationRunEvent, "id" | "timestamp">) => {
      eventCount += 1;
      onEvent?.({ id: `browser_sim_event_${eventCount}`, timestamp: new Date().toISOString(), ...event });
    };
    emit({ type: "run_started", label: "推演开始", detail: `${mockChainLabel}：${scenario.title}` });

    const mockActions = [
      "压低声音试探对方的来意。",
      "抢先一步挡住了退路。",
      "把关键的秘密只说了一半。",
      "突然转身，打破了僵持。"
    ];
    const branches: SimulationBranch[] = [];
    for (let branchIndex = 0; branchIndex < scenario.branchCount; branchIndex += 1) {
      const label = `走向 ${String.fromCharCode(65 + branchIndex)}`;
      const premiseShift =
        branchIndex === 0 ? "冲突被摆上台面，双方摊牌。" : `有人选择退让，局势转向第 ${branchIndex + 1} 种可能。`;
      emit({ type: "branch_started", label: `${label} 开始`, detail: premiseShift });
      const branch: SimulationBranch = { id: `branch_${branchIndex + 1}`, label, premiseShift, turns: [], outcome: "" };
      for (let turnNumber = 1; turnNumber <= scenario.maxTurns; turnNumber += 1) {
        await browserDelay(80, signal);
        const { participant, name } = cast[(turnNumber - 1) % cast.length];
        const action = `${name}${mockActions[(turnNumber + branchIndex) % mockActions.length]}`;
        branch.turns.push({
          id: `${branch.id}_turn_${turnNumber}`,
          turn: turnNumber,
          actorId: participant.characterId,
          actorName: name,
          intent: participant.goal || "推进自己的目标",
          action,
          dialogue: turnNumber % 2 === 1 ? "……你到底想要什么？" : ""
        });
        emit({ type: "turn_completed", label: `${label} · 第 ${turnNumber} 轮 · ${name}`, detail: action });
      }
      branch.outcome =
        branchIndex === 0
          ? `${mockChainLabel}：冲突公开化，代价是信任破裂。`
          : `${mockChainLabel}：表面缓和，但埋下了第 ${branchIndex + 1} 层隐患。`;
      branches.push(branch);
      emit({ type: "branch_completed", label: `${label} 完成`, detail: branch.outcome });
    }

    const run: SimulationRun = {
      schemaVersion: "0.1.0",
      id: `browser_sim_run_${Date.now()}`,
      scenarioId: scenario.id,
      status: "completed",
      branches: dedupeSimulationBranches(branches),
      model: "browser-mock",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      error: "",
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString()
    };
    emit({ type: "run_completed", label: "推演完成", detail: `共 ${run.branches.length} 条走向` });
    const next = SimulationDocumentSchema.parse({ scenario, runs: [run, ...document.runs].slice(0, 10) });
    browserSimulations.set(input.projectPath, [next, ...documents.filter((item) => item.scenario.id !== scenario.id)]);
    return structuredClone(next);
  },
  async cancelSimulation(): Promise<void> {
    return undefined;
  },
  async listProviderPresets() {
    return structuredClone(browserProviderPresets);
  },
  async probeProvider() {
    const provider = readProviderStorage();
    const ok = hasAuthMaterial(provider.authMode, provider.apiKey);
    return {
      ok,
      checkedAt: new Date().toISOString(),
      latencyMs: 24,
      modelReachable: ok,
      capabilities: { streaming: ok, tools: ok },
      message: ok ? "浏览器演示探测通过；桌面版将执行真实兼容性请求。" : "请先配置模型。"
    };
  },
  async getReleaseReadiness(projectPath) {
    const record = getProjectRecord(projectPath);
    const chapters = record.summary.outline.volumes
      .flatMap((volume) => volume.chapters)
      .filter((chapter) => !chapter.archived);
    const covered = new Set(browserQualityReports.map((report) => report.chapterId)).size;
    const pending = browserBranches.filter((branch) => branch.status === "draft").length;
    const provider = providerStatusFromStorage(readProviderStorage());
    const items = [
      { id: "project-shape", label: "项目结构", status: "ready" as const, detail: "核心项目文件齐全。" },
      {
        id: "provider",
        label: "模型配置",
        status: provider.configured ? ("ready" as const) : ("warning" as const),
        detail: provider.configured ? provider.model : "尚未配置可用模型。"
      },
      {
        id: "quality",
        label: "质量回归",
        status: covered >= chapters.length ? ("ready" as const) : ("warning" as const),
        detail: `${covered}/${chapters.length} 个章节已有报告。`
      },
      {
        id: "branches",
        label: "待处理分支",
        status: pending ? ("warning" as const) : ("ready" as const),
        detail: pending ? `${pending} 个草稿分支待决定。` : "没有待处理分支。"
      },
      { id: "batch", label: "批量任务", status: "ready" as const, detail: "没有运行中的批量任务。" },
      {
        id: "manuscript",
        label: "正文完整度",
        status: chapters.every(
          (chapter) => chapter.status === "done" || chapter.actualWords >= chapter.targetWords * 0.5
        )
          ? ("ready" as const)
          : ("warning" as const),
        detail: `${chapters.length} 个有效章节。`
      },
      {
        id: "distribution",
        label: "签名与自动更新",
        status: "warning" as const,
        detail: "公开分发前需配置签名证书和更新源。"
      }
    ];
    const score = Math.round(items.reduce((sum, item) => sum + (item.status === "ready" ? 100 : 55), 0) / items.length);
    return { checkedAt: new Date().toISOString(), score, ready: true, items };
  }
};

const browserProviderPresets = [
  {
    id: "openai",
    displayName: "OpenAI",
    category: "cloud" as const,
    description: "官方 OpenAI 兼容端点。",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1-mini",
    authMode: "bearer" as const,
    expectedCapabilities: { streaming: true, tools: true }
  },
  {
    id: "deepseek",
    displayName: "DeepSeek",
    category: "cloud" as const,
    description: "DeepSeek 官方端点，支持流式写作与 Agent 工具调用。",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    authMode: "bearer" as const,
    expectedCapabilities: { streaming: true, tools: true }
  },
  {
    id: "gemini-openai",
    displayName: "Gemini · OpenAI 兼容",
    category: "cloud" as const,
    description: "Gemini OpenAI 兼容端点。",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-3.6-flash",
    authMode: "bearer" as const,
    expectedCapabilities: { streaming: true, tools: true }
  },
  {
    id: "ollama",
    displayName: "Ollama",
    category: "local" as const,
    description: "本机 Ollama 服务。",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "qwen3",
    authMode: "none" as const,
    expectedCapabilities: { streaming: true, tools: true }
  },
  {
    id: "lm-studio",
    displayName: "LM Studio",
    category: "local" as const,
    description: "本机 LM Studio 服务。",
    baseUrl: "http://127.0.0.1:1234/v1",
    model: "local-model",
    authMode: "none" as const,
    expectedCapabilities: { streaming: true, tools: false }
  },
  {
    id: "claude-gateway",
    displayName: "Claude · 兼容网关",
    category: "gateway" as const,
    description: "OpenAI 协议 Claude 网关。",
    baseUrl: "https://your-claude-gateway.example/v1",
    model: "claude-model",
    authMode: "bearer" as const,
    expectedCapabilities: { streaming: true, tools: true }
  }
];

const browserLineDiff = (before: string, after: string): BranchDiffLine[] => {
  if (before === after) return before.split(/\r?\n/u).map((text) => ({ kind: "context", text }));
  return [
    ...before.split(/\r?\n/u).map((text) => ({ kind: "remove" as const, text })),
    ...after.split(/\r?\n/u).map((text) => ({ kind: "add" as const, text }))
  ];
};

const browserDelay = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Request cancelled.", "AbortError"));
      return;
    }
    const timeoutId = window.setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timeoutId);
        reject(new DOMException("Request cancelled.", "AbortError"));
      },
      { once: true }
    );
  });

const electronBridge = window.inkforge as Partial<InkforgeApi> | undefined;

export const bridge: InkforgeApi = new Proxy(browserBridge, {
  get(target, key: keyof InkforgeApi) {
    const browserValue = target[key];
    if (!electronBridge) {
      return browserValue;
    }
    if (key === "runAiTask" && electronBridge.runAiTask && electronBridge.cancelAiTask) {
      return (input: AiTaskInput, signal?: AbortSignal, onDelta?: (chunk: string) => void) =>
        invokeWithRendererAbort({
          input,
          signal,
          requestPrefix: "ai",
          invoke: (requestInput) => electronBridge.runAiTask!(requestInput, undefined, onDelta),
          cancel: (requestId) => electronBridge.cancelAiTask!(requestId)
        });
    }
    if (key === "runPlanningAi" && electronBridge.runPlanningAi && electronBridge.cancelPlanningAi) {
      return (input: Parameters<InkforgeApi["runPlanningAi"]>[0], signal?: AbortSignal) =>
        invokeWithRendererAbort({
          input,
          signal,
          requestPrefix: "planning",
          invoke: (requestInput) => electronBridge.runPlanningAi!(requestInput),
          cancel: (requestId) => electronBridge.cancelPlanningAi!(requestId)
        });
    }
    if (key === "runSimulation" && electronBridge.runSimulation && electronBridge.cancelSimulation) {
      return (input: SimulationRunInput, signal?: AbortSignal, onEvent?: (event: SimulationRunEvent) => void) =>
        invokeWithRendererAbort({
          input,
          signal,
          requestPrefix: "simulation",
          invoke: (requestInput) => electronBridge.runSimulation!(requestInput, undefined, onEvent),
          cancel: (requestId) => electronBridge.cancelSimulation!(requestId)
        });
    }
    if (key === "runAgentChat" && electronBridge.runAgentChat && electronBridge.cancelAgentChat) {
      return (input: AgentChatInput, signal?: AbortSignal, onEvent?: (event: AgentRunEvent) => void) =>
        invokeWithRendererAbort({
          input,
          signal,
          requestPrefix: "agent-chat",
          invoke: (requestInput) => electronBridge.runAgentChat!(requestInput, undefined, onEvent),
          cancel: (requestId) => electronBridge.cancelAgentChat!(requestId)
        });
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
