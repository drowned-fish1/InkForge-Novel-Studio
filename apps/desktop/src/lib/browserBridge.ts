import { searchChapterContent, searchStoryEntries } from "../../electron/services/ProjectSearchEntries";
import {
  normalizeProviderEndpoint,
  providerRoles,
  assertProviderRole,
  resolveProvider,
  type ProviderEndpointConfig,
  type ProviderEndpointStatus
} from "@inkforge/ai-provider";
import {
  defaultAgentMembers,
  applyProjectDataUpdate,
  ProjectDataSchema,
  ProjectDataUpdateSchema,
  migrateProjectDataTools,
  estimateTokensCjkAware,
  runExportPreflight,
  BeatBoardSchema,
  CanonFactSchema,
  ChapterContractSchema,
  ExportConfigSchema,
  EvidencePackSchema,
  type ExportConfig,
  compileBeatBoardToInk,
  compileBeatBoardToTwee,
  dedupeSimulationBranches,
  SimulationDocumentSchema,
  SimulationScenarioSchema,
  StoryThreadSchema,
  StyleProfileSchema,
  type BatchRun,
  type BackupSettings,
  type BackupSnapshot,
  type BeatBoard,
  type RevisionState,
  type BranchDiffLine,
  type AgentExtensionConfig,
  type QualityReport,
  type SimulationBranch,
  type SimulationDocument,
  type SimulationRun,
  type SimulationScenario,
  type CanonFact,
  type CanonFactStatus,
  type StoryThread,
  type StoryThreadStatus,
  type StyleProfile,
  type StoryBranch,
  type WritingWorkspace,
  WritingWorkspaceSchema
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
  ChapterHistoryEntry,
  ExportInput,
  ProjectSearchResult,
  QualitySweepEntry,
  QualitySweepResult,
  RevisionProposalSummary,
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
import type {
  AdoptCorpusInput,
  AnalysisJob,
  AnalysisJobStartInput,
  CorpusAdoptionResult,
  CorpusImportManifest,
  CorpusImportStartInput,
  ImportProgress,
  IndexChapterInput,
  IndexProjectInput,
  InkforgeApi,
  SaveCanonFactInput,
  SaveStoryThreadInput,
  ContinuationRun,
  ContinuationRunInput,
  ContinuationRunResult
} from "../../electron/types";
import { hasAuthMaterial, maskApiKey, runBrowserAiTask } from "@/lib/browserAiProvider";
import { browserLibraryService } from "@/lib/browserLibraryService";
import { exportManuscriptInBrowser } from "@/lib/browserManuscriptExport";
import { browserProjectService } from "@/lib/browserProjectService";
import { invokeWithRendererAbort } from "@/lib/rendererAbort";
import { countCjkAwareWords } from "@/lib/textMetrics";
import {
  getProjectRecord,
  readProviderStorage,
  saveProjectRecord,
  writeProviderStorage,
  type BrowserProviderStorage
} from "@/lib/browserStorage";

const endpointStatus = (provider: ProviderEndpointConfig): ProviderEndpointStatus => {
  const { apiKey, ...endpoint } = normalizeProviderEndpoint(provider);
  return {
    ...endpoint,
    configured: hasAuthMaterial(provider.authMode, apiKey ?? ""),
    maskedKey: maskApiKey(apiKey ?? "")
  };
};
const providerStatusFromStorage = (provider: BrowserProviderStorage): ProviderStatus => ({
  ...endpointStatus(provider),
  editorModel: provider.editorModel,
  updatedAt: provider.updatedAt || undefined,
  taskProviders: Object.fromEntries(
    providerRoles
      .filter((role) => provider.taskProviders?.[role])
      .map((role) => [role, endpointStatus(provider.taskProviders![role]!)])
  )
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
const browserBackupSettings = new Map<string, BackupSettings>();
const browserRevisionStates = new Map<string, RevisionState>();
const browserExportConfigs = new Map<string, ExportConfig>();
const browserSimulations = new Map<string, SimulationDocument[]>();
const browserWritingWorkspaces = new Map<string, WritingWorkspace>();
const browserAgentExtensions = new Map<string, AgentExtensionConfig>();
const browserCorpusImports = new Map<string, CorpusImportManifest[]>();
const browserCorpusContents = new Map<string, Record<string, string>>();
const browserAnalysisJobs = new Map<string, AnalysisJob[]>();
const browserChunkIndexes = new Map<
  string,
  Array<{
    id: string;
    chapterId: string;
    chapterTitle: string;
    chunkIndex: number;
    startOffset: number;
    endOffset: number;
    text: string;
    contentHash: string;
    chapterContentHash: string;
    vector: number[];
    sceneId?: string;
    sceneTitle?: string;
  }>
>();
const browserCanonFacts = new Map<string, CanonFact[]>();
const browserStoryThreads = new Map<string, StoryThread[]>();
const browserStyleProfiles = new Map<string, StyleProfile>();
const browserContinuationRuns = new Map<string, ContinuationRun[]>();

const browserHash = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `browser-${(hash >>> 0).toString(16).padStart(8, "0")}`;
};

const browserWordCount = (value: string): number => value.replace(/\s/gu, "").length;

const browserProjectChapters = (projectPath: string) =>
  getProjectRecord(projectPath).summary.outline.volumes.flatMap((volume) => volume.chapters);

const browserImportFor = (projectPath: string, importId: string): CorpusImportManifest => {
  const manifest = browserCorpusImports.get(projectPath)?.find((item) => item.id === importId);
  if (!manifest) throw new Error("Import not found.");
  return manifest;
};

const browserEnsureStyle = (projectPath: string): StyleProfile => {
  const existing = browserStyleProfiles.get(projectPath);
  if (existing) return structuredClone(existing);
  return StyleProfileSchema.parse({ id: "default", name: "Browser demo style", version: 1 });
};

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
  async getUpdateStatus() {
    return {
      phase: "disabled",
      configured: false,
      currentVersion: "browser-preview",
      message: "Automatic updates are only available in packaged desktop builds."
    };
  },
  async checkForUpdates() {
    return this.getUpdateStatus();
  },
  async downloadUpdate() {
    return this.getUpdateStatus();
  },
  async installUpdate() {
    return false;
  },
  ...browserProjectService,
  ...browserLibraryService,
  async exportManuscript(input: ExportInput): Promise<string> {
    return exportManuscriptInBrowser(input);
  },
  async loadExportConfig(projectPath) {
    return structuredClone(browserExportConfigs.get(projectPath) ?? ExportConfigSchema.parse({}));
  },
  async saveExportConfig(projectPath, config) {
    const parsed = ExportConfigSchema.parse(config);
    browserExportConfigs.set(projectPath, parsed);
    return structuredClone(parsed);
  },
  async exportPreflight(projectPath) {
    const record = getProjectRecord(projectPath);
    const config = browserExportConfigs.get(projectPath) ?? ExportConfigSchema.parse({});
    return runExportPreflight({
      volumes: record.summary.outline.volumes.map((volume) => ({
        title: volume.title,
        chapters: volume.chapters.map((chapter) => ({
          id: chapter.id,
          title: chapter.title,
          content: record.chapterBodies[chapter.file] ?? "",
          archived: chapter.archived
        }))
      })),
      epub: config.epub,
      coverExists: config.epub.coverImagePath ? false : undefined
    });
  },
  async chooseCoverImage() {
    return undefined;
  },
  async listBackups(projectPath) {
    return structuredClone(browserBackups.get(projectPath) ?? []);
  },
  async inspectBackups(projectPath) {
    const snapshots = structuredClone(browserBackups.get(projectPath) ?? []);
    return {
      snapshots,
      corrupted: [],
      totalSize: snapshots.reduce((total, item) => total + item.size, 0),
      backupRoot: "浏览器本地存储（模拟备份，仅用于预览界面）"
    };
  },
  async createBackup(projectPath, label) {
    const snapshot: BackupSnapshot = {
      id: `browser-backup-${Date.now()}`,
      createdAt: new Date().toISOString(),
      reason: "manual",
      label: label ?? "",
      fileCount: 8,
      size: 16_384,
      chapterHashes: {},
      changedChapterFiles: []
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
  async verifyBackup(_projectPath, snapshotId) {
    return {
      snapshotId,
      ok: true,
      checkedFiles: 0,
      issues: ["浏览器预览使用模拟备份，未执行真实文件校验。"]
    };
  },
  async diffBackup(_projectPath, snapshotId) {
    return {
      snapshotId,
      addedChapters: [],
      removedChapters: [],
      modifiedChapters: [],
      changedMetaFiles: []
    };
  },
  async readBackupFile() {
    throw new Error("浏览器预览的模拟备份不保存文件内容，请在桌面版查看差异。");
  },
  async loadBackupSettings(projectPath) {
    return structuredClone(
      browserBackupSettings.get(projectPath) ?? {
        automaticIntervalMinutes: 10,
        maxAutomaticSnapshots: 20,
        maxTotalSizeMb: 512,
        backupDirectory: ""
      }
    );
  },
  async saveBackupSettings(projectPath, settings) {
    browserBackupSettings.set(projectPath, structuredClone(settings));
    return structuredClone(settings);
  },
  async chooseBackupDirectory() {
    return undefined;
  },
  async inspectProjectFolder() {
    return [];
  },
  async chooseProjectFolder() {
    return undefined;
  },
  async listChapterHistoryOverview(projectPath, files) {
    const overview: Record<string, ChapterHistoryEntry[]> = {};
    for (const file of files) {
      overview[file] = await browserProjectService.listChapterHistory(projectPath, file);
    }
    return overview;
  },
  async loadWritingWorkspace(projectPath) {
    const cached = browserWritingWorkspaces.get(projectPath);
    const saved = localStorage.getItem(`inkforge.writingWorkspace.${projectPath}`);
    return structuredClone(cached ?? WritingWorkspaceSchema.parse(saved ? JSON.parse(saved) : {}));
  },
  async searchProject(projectPath, query) {
    const trimmed = query.trim();
    if (!trimmed) {
      return [];
    }
    const record = getProjectRecord(projectPath);
    const results: ProjectSearchResult[] = [];
    for (const volume of record.summary.outline.volumes) {
      for (const chapter of volume.chapters) {
        if (chapter.archived || results.length >= 60) continue;
        results.push(
          ...searchChapterContent(chapter, volume.title, record.chapterBodies[chapter.file] ?? "", trimmed).slice(
            0,
            60 - results.length
          )
        );
      }
    }
    results.push(
      ...searchStoryEntries(
        {
          characters: record.characters,
          world: record.worldEntries,
          conflicts: record.conflicts ?? [],
          clues: record.clues ?? [],
          terms: record.terms ?? [],
          timeline: record.timeline ?? []
        },
        trimmed,
        60 - results.length
      )
    );
    return results;
  },
  async revisionOverview(projectPath) {
    const record = getProjectRecord(projectPath);
    const chapters = record.summary.outline.volumes.flatMap((volume) => volume.chapters);
    const chapterTitle = new Map(chapters.map((chapter) => [chapter.id, chapter.title]));
    const workspace = await browserBridge.loadWritingWorkspace(projectPath);
    const proposals: RevisionProposalSummary[] = [];
    if (browserAgentSession) {
      for (const proposal of browserAgentSession.proposals.filter((item) => item.status === "pending")) {
        proposals.push({
          id: proposal.id,
          chapterId: proposal.chapterId,
          chapterTitle: chapterTitle.get(proposal.chapterId) ?? proposal.chapterId,
          kind: "change",
          mode: proposal.mode,
          title: proposal.mode === "append" ? "续写提案" : proposal.mode === "replace" ? "替换提案" : "结构化改稿",
          explanation: proposal.explanation,
          createdAt: proposal.createdAt,
          blockCount: proposal.blocks.length,
          contentPreview: proposal.content.slice(0, 200)
        });
      }
      for (const proposal of browserAgentSession.dataProposals.filter((item) => item.status === "pending")) {
        proposals.push({
          id: proposal.id,
          chapterId: browserAgentSession.chapterId,
          chapterTitle: chapterTitle.get(browserAgentSession.chapterId) ?? browserAgentSession.chapterId,
          kind: "data",
          entityType: proposal.entityType,
          title: proposal.title,
          explanation: proposal.explanation,
          createdAt: proposal.createdAt,
          blockCount: 0,
          contentPreview: JSON.stringify(proposal.payload).slice(0, 200)
        });
      }
    }
    const continuityIssues = (await browserLibraryService.inspectStory(projectPath)).filter(
      (issue) => issue.id !== "ok"
    );
    return {
      annotations: workspace.annotations.map((annotation) => ({
        ...annotation,
        chapterTitle: chapterTitle.get(annotation.chapterId) ?? annotation.chapterId
      })),
      qualityReports: browserQualityReports.slice(0, 20).map((report) => ({
        chapterId: report.chapterId,
        chapterTitle: chapterTitle.get(report.chapterId) ?? report.chapterTitle,
        overallScore: report.overallScore,
        baselineDelta: report.baselineDelta,
        createdAt: report.createdAt,
        findings: report.findings
      })),
      continuityIssues,
      proposals,
      revisionState: structuredClone(browserRevisionStates.get(projectPath) ?? { dispositions: [] })
    };
  },
  async setRevisionDisposition(projectPath, key, status, note = "") {
    const state = browserRevisionStates.get(projectPath) ?? { dispositions: [] };
    const disposition = { key, status, note, updatedAt: new Date().toISOString() };
    const existing = state.dispositions.findIndex((item) => item.key === key);
    const dispositions =
      existing >= 0
        ? state.dispositions.map((item, index) => (index === existing ? disposition : item))
        : [...state.dispositions, disposition];
    const next = { dispositions };
    browserRevisionStates.set(projectPath, next);
    return structuredClone(next);
  },
  async saveWritingWorkspace(projectPath, workspace) {
    const parsed = WritingWorkspaceSchema.parse(workspace);
    localStorage.setItem(`inkforge.writingWorkspace.${projectPath}`, JSON.stringify(parsed));
    browserWritingWorkspaces.set(projectPath, structuredClone(parsed));
    return structuredClone(parsed);
  },
  async loadAgentExtensions(projectPath) {
    return structuredClone(
      migrateProjectDataTools(
        browserAgentExtensions.get(projectPath) ?? {
          promptPresets: [],
          toolProfiles: [],
          customTools: [],
          members: defaultAgentMembers,
          taskTemplates: [],
          workflowTemplates: []
        }
      )
    );
  },
  async estimateAgentRun(input) {
    const messageTokens = estimateTokensCjkAware(input.message);
    return {
      estimated: true,
      promptTokens: messageTokens + 3_000,
      maxCompletionTokens: 4_096,
      contextTokens: 2_400,
      historyTokens: 600,
      messageTokens
    };
  },
  async approveAgentTool() {
    return undefined;
  },
  async saveAgentExtensions(projectPath, config) {
    const saved = { ...config, projectDataToolsVersion: 1 as const };
    browserAgentExtensions.set(projectPath, structuredClone(saved));
    return structuredClone(saved);
  },
  async providerStatus(): Promise<ProviderStatus> {
    return providerStatusFromStorage(readProviderStorage());
  },
  async saveProviderConfig(input: ProviderConfigInput): Promise<ProviderStatus> {
    const existing = readProviderStorage();
    const store = (
      raw: ProviderEndpointConfig,
      previous?: ProviderEndpointConfig,
      allowUnconfigured = false
    ): ProviderEndpointConfig => {
      const endpoint = normalizeProviderEndpoint(raw);
      const canRetain =
        previous?.baseUrl?.trim().replace(/\/+$/, "") === endpoint.baseUrl && previous.authMode === endpoint.authMode;
      const apiKey = endpoint.authMode === "none" ? "" : endpoint.apiKey || (canRetain ? previous?.apiKey : "");
      if (!hasAuthMaterial(endpoint.authMode, apiKey ?? "") && (!allowUnconfigured || previous?.apiKey))
        throw new Error(`${endpoint.displayName}：请填写 API Key；更换地址或鉴权方式后需重新填写。`);
      return { ...endpoint, apiKey };
    };
    const taskProviders =
      input.taskProviders === undefined
        ? existing.taskProviders
        : ({} as NonNullable<ProviderConfigInput["taskProviders"]>);
    if (input.taskProviders !== undefined) {
      for (const role of Object.keys(input.taskProviders)) assertProviderRole(role);
      for (const role of providerRoles) {
        if (input.taskProviders[role])
          taskProviders![role] = store(input.taskProviders[role], existing.taskProviders?.[role]);
      }
    }
    const endpoint = store(input, existing, true);
    const provider: BrowserProviderStorage = {
      ...endpoint,
      apiKey: endpoint.apiKey ?? "",
      editorModel: input.editorModel?.trim() || undefined,
      taskProviders,
      updatedAt: new Date().toISOString()
    };
    writeProviderStorage(provider);
    return providerStatusFromStorage(provider);
  },
  async runAiTask(input: AiTaskInput, signal?: AbortSignal, onDelta?: (chunk: string) => void): Promise<AiTaskResult> {
    const provider = readProviderStorage();
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
    const oldProposalIds = new Set(session.proposals.map((proposal) => proposal.id));
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
      usage: { promptTokens: 216, completionTokens: 74, totalTokens: 290, estimated: true }
    });
    emit({
      type: "run_completed",
      label: "本轮完成",
      detail: "",
      durationMs: 640,
      usage: { promptTokens: 216, completionTokens: 74, totalTokens: 290, estimated: true }
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
      usage: { promptTokens: 216, completionTokens: 74, totalTokens: 290, estimated: true },
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
    if (input.yolo && input.mode !== "plan" && input.writingApproach !== "compare") {
      const newProposals = session.proposals.filter(
        (proposal) => !oldProposalIds.has(proposal.id) && proposal.status === "pending"
      );
      for (const proposal of newProposals) {
        for (const block of proposal.blocks.filter((block) => block.status === "pending"))
          await this.resolveAgentChange({
            projectPath: input.projectPath,
            chapterId: input.chapterId,
            proposalId: proposal.id,
            blockId: block.id,
            action: "accept-block"
          });
        await this.resolveAgentChange({
          projectPath: input.projectPath,
          chapterId: input.chapterId,
          proposalId: proposal.id,
          action: "apply"
        });
      }
      return this.loadAgentChat(input.projectPath, input.chapterId);
    }
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
    if (!proposal || proposal.status !== "pending") {
      throw new Error("找不到资料修改提案。");
    }
    if (input.action === "apply" && proposal.entityType === "project_data") {
      const key = `inkforge.projectData.${input.projectPath}`;
      const current = ProjectDataSchema.parse(JSON.parse(localStorage.getItem(key) ?? "{}"));
      localStorage.setItem(
        key,
        JSON.stringify(applyProjectDataUpdate(current, ProjectDataUpdateSchema.parse(proposal.payload)))
      );
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
    const wordCount = countCjkAwareWords(content);
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
  async evaluateProjectQuality(projectPath): Promise<QualitySweepResult> {
    const record = getProjectRecord(projectPath);
    const chapters = record.summary.outline.volumes
      .flatMap((volume) => volume.chapters)
      .filter((chapter) => !chapter.archived);
    const entries: QualitySweepEntry[] = [];
    for (const chapter of chapters) {
      const report = await browserBridge.evaluateChapterQuality(projectPath, chapter.id);
      entries.push({
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        wordCount: report.wordCount,
        overallScore: report.overallScore,
        baselineDelta: report.baselineDelta,
        warningCount: report.findings.filter((item) => item.severity === "warning").length,
        infoCount: report.findings.filter((item) => item.severity === "info").length,
        topFinding: report.findings[0]?.title
      });
    }
    entries.sort((a, b) => a.overallScore - b.overallScore);
    const issues = await browserLibraryService.inspectStory(projectPath);
    return {
      generatedAt: new Date().toISOString(),
      chapterCount: entries.length,
      averageScore: entries.length
        ? Math.round((entries.reduce((total, entry) => total + entry.overallScore, 0) / entries.length) * 10) / 10
        : 0,
      continuityIssueCount: issues.filter((issue) => issue.severity !== "info").length,
      entries
    };
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
  async chooseCorpusSource(): Promise<string | undefined> {
    // Browser demo mode cannot safely expose arbitrary local paths. The
    // import form can still accept a caller-provided sourcePath.
    return undefined;
  },
  async startCorpusImport(input: CorpusImportStartInput, onProgress?: (progress: ImportProgress) => void) {
    const project = getProjectRecord(input.projectPath);
    const importId = input.importId?.trim() || `browser-import-${Date.now()}`;
    const previous = browserCorpusImports.get(input.projectPath)?.find((item) => item.id === importId);
    if (previous?.status === "completed") return structuredClone(previous);
    const sourcePath = input.sourcePath || "browser-project-chapters";
    const chapters = browserProjectChapters(input.projectPath);
    const contents: Record<string, string> = {};
    const imported = chapters.map((chapter, index) => {
      const content = project.chapterBodies[chapter.file] ?? "";
      const chapterId = `${importId}-ch-${String(index + 1).padStart(5, "0")}`;
      const contentPath = `.inkforge/continuation/corpus/${importId}/chapters/ch-${String(index + 1).padStart(5, "0")}.md`;
      contents[chapterId] = content;
      return {
        id: chapterId,
        key: `browser:${chapter.id}`,
        ordinal: index,
        title: chapter.title,
        sourcePath,
        sourceIndex: 0,
        chapterIndex: index,
        contentPath,
        startOffset: 0,
        endOffset: content.length,
        byteStart: 0,
        byteEnd: content.length,
        contentHash: browserHash(content),
        charCount: content.length,
        wordCount: browserWordCount(content),
        status: "imported" as const,
        importedAt: new Date().toISOString()
      };
    });
    browserCorpusContents.set(`${input.projectPath}:${importId}`, contents);
    const now = new Date().toISOString();
    const manifest: CorpusImportManifest = {
      schemaVersion: 1,
      id: importId,
      projectPath: input.projectPath,
      sourcePath,
      sourceType: "file",
      sourceFiles: [
        { index: 0, path: sourcePath, size: imported.reduce((sum, item) => sum + item.charCount, 0), modifiedAt: now }
      ],
      encoding: input.encoding ?? "utf8",
      encodingConfidence: 1,
      status: "completed",
      totalBytes: imported.reduce((sum, item) => sum + item.charCount, 0),
      bytesRead: imported.reduce((sum, item) => sum + item.charCount, 0),
      chapters: imported,
      duplicateChapterIds: [],
      checkpoint: {
        sourceIndex: 0,
        chapterIndex: Math.max(-1, imported.length - 1),
        nextSourceIndex: 1,
        bytesRead: imported.reduce((sum, item) => sum + item.charCount, 0),
        lastChapterId: imported.at(-1)?.id,
        updatedAt: now
      },
      createdAt: now,
      updatedAt: now
    };
    const imports = browserCorpusImports.get(input.projectPath) ?? [];
    browserCorpusImports.set(input.projectPath, [manifest, ...imports.filter((item) => item.id !== importId)]);
    onProgress?.({
      importId,
      status: "completed",
      bytesRead: manifest.bytesRead,
      totalBytes: manifest.totalBytes,
      completedChapters: manifest.chapters.length,
      checkpoint: manifest.checkpoint
    });
    return structuredClone(manifest);
  },
  async listCorpusImports(projectPath: string) {
    return structuredClone(browserCorpusImports.get(projectPath) ?? []);
  },
  async pauseCorpusImport(projectPath: string, importId: string) {
    return structuredClone(browserImportFor(projectPath, importId));
  },
  async resumeCorpusImport(projectPath: string, importId: string, onProgress?: (progress: ImportProgress) => void) {
    const manifest = browserImportFor(projectPath, importId);
    onProgress?.({
      importId,
      status: manifest.status,
      bytesRead: manifest.bytesRead,
      totalBytes: manifest.totalBytes,
      completedChapters: manifest.chapters.length,
      checkpoint: manifest.checkpoint
    });
    return structuredClone(manifest);
  },
  async cancelCorpusImport(projectPath: string, importId: string) {
    const manifest = browserImportFor(projectPath, importId);
    if (manifest.status === "completed") return structuredClone(manifest);
    const next = { ...manifest, status: "cancelled" as const, updatedAt: new Date().toISOString() };
    browserCorpusImports.set(projectPath, [
      next,
      ...(browserCorpusImports.get(projectPath) ?? []).filter((item) => item.id !== importId)
    ]);
    return structuredClone(next);
  },
  async adoptCorpusImport(input: AdoptCorpusInput): Promise<CorpusAdoptionResult> {
    const manifest = browserImportFor(input.projectPath, input.importId);
    if (manifest.status !== "completed") throw new Error("Import must be completed before adoption.");
    const record = getProjectRecord(input.projectPath);
    const existing = record.summary.outline.volumes.flatMap((volume) => volume.chapters);
    const adoptedIds = new Set(
      existing.flatMap((chapter) => {
        const match = /\[corpus:(.+?)\]/u.exec(chapter.notes);
        return match?.[1] ? [match[1]] : [];
      })
    );
    const candidates = manifest.chapters.filter((chapter) => input.includeDuplicates || chapter.status !== "duplicate");
    const pending = candidates.filter((chapter) => !adoptedIds.has(chapter.id));
    if (!pending.length) {
      return {
        importId: input.importId,
        adoptedChapters: 0,
        skippedDuplicates: manifest.duplicateChapterIds.length,
        alreadyAdopted: candidates.length,
        volumeIds: []
      };
    }
    const volumeSize = Math.max(20, Math.min(500, Math.trunc(input.volumeSize ?? 100)));
    const contents = browserCorpusContents.get(`${input.projectPath}:${input.importId}`) ?? {};
    const volumeIds: string[] = [];
    for (let offset = 0; offset < pending.length; offset += volumeSize) {
      const group = pending.slice(offset, offset + volumeSize);
      const volumeId = `browser-corpus-${input.importId}-${volumeIds.length + 1}`;
      volumeIds.push(volumeId);
      const volumeNumber = record.summary.outline.volumes.length + volumeIds.length;
      const chapters = group.map((item, index) => {
        const number = existing.length + offset + index + 1;
        const file = `chapters/volume-corpus-${input.importId}-${String(volumeIds.length).padStart(3, "0")}/ch-${String(number).padStart(5, "0")}.md`;
        record.chapterBodies[file] = contents[item.id] ?? "";
        return {
          id: `browser-${item.id}`,
          number,
          title: item.title || `第${number}章`,
          file,
          goal: "",
          hook: "",
          status: "done" as const,
          targetWords: Math.max(1, item.charCount),
          actualWords: item.charCount,
          archived: false,
          notes: `[corpus:${item.id}] 来源：${item.sourcePath}`,
          conflictPoints: "",
          characters: [],
          worldRefs: []
        };
      });
      record.summary.outline.volumes.push({
        id: volumeId,
        title: `${input.volumeTitlePrefix?.trim() || "导入卷"} ${volumeNumber}`,
        goal: "",
        targetWords: chapters.reduce((sum, chapter) => sum + chapter.targetWords, 0),
        chapters
      });
      existing.push(...chapters);
    }
    saveProjectRecord(record);
    return {
      importId: input.importId,
      adoptedChapters: pending.length,
      skippedDuplicates: manifest.duplicateChapterIds.length,
      alreadyAdopted: candidates.length - pending.length,
      volumeIds
    };
  },
  async startAnalysisJob(
    input: AnalysisJobStartInput,
    onProgress?: (progress: import("../../electron/services/ContinuationTypes.js").AnalysisProgress) => void
  ) {
    const manifest = browserImportFor(input.projectPath, input.importId);
    const selected = input.chapterIds?.length
      ? manifest.chapters.filter((chapter) => input.chapterIds?.includes(chapter.id))
      : manifest.chapters;
    const now = new Date().toISOString();
    const jobId = input.jobId?.trim() || `browser-analysis-${Date.now()}`;
    const job: AnalysisJob = {
      schemaVersion: 1,
      id: jobId,
      projectPath: input.projectPath,
      importId: input.importId,
      status: "completed",
      tasks: selected.map((chapter) => ({
        id: `${jobId}:${chapter.id}`,
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        contentHash: chapter.contentHash,
        status: "completed" as const,
        analysisPath: `.inkforge/continuation/analysis/${input.importId}/${chapter.id}.json`
      })),
      completedTasks: selected.length,
      checkpoint: { taskIndex: selected.length - 1, lastChapterId: selected.at(-1)?.id, updatedAt: now },
      createdAt: now,
      updatedAt: now
    };
    const jobs = browserAnalysisJobs.get(input.projectPath) ?? [];
    browserAnalysisJobs.set(input.projectPath, [job, ...jobs.filter((item) => item.id !== jobId)]);
    onProgress?.({
      jobId,
      status: "completed",
      completedTasks: job.completedTasks,
      totalTasks: job.tasks.length,
      currentChapterId: selected.at(-1)?.id,
      checkpoint: job.checkpoint
    });
    return structuredClone(job);
  },
  async listAnalysisJobs(projectPath: string) {
    return structuredClone(browserAnalysisJobs.get(projectPath) ?? []);
  },
  async pauseAnalysisJob(projectPath: string, jobId: string) {
    const job = browserAnalysisJobs.get(projectPath)?.find((item) => item.id === jobId);
    if (!job) throw new Error("Analysis job not found.");
    return structuredClone(job);
  },
  async resumeAnalysisJob(
    projectPath: string,
    jobId: string,
    onProgress?: (progress: import("../../electron/services/ContinuationTypes.js").AnalysisProgress) => void
  ) {
    const job = browserAnalysisJobs.get(projectPath)?.find((item) => item.id === jobId);
    if (!job) throw new Error("Analysis job not found.");
    onProgress?.({
      jobId,
      status: job.status,
      completedTasks: job.completedTasks,
      totalTasks: job.tasks.length,
      checkpoint: job.checkpoint
    });
    return structuredClone(job);
  },
  async cancelAnalysisJob(projectPath: string, jobId: string) {
    const job = browserAnalysisJobs.get(projectPath)?.find((item) => item.id === jobId);
    if (!job) throw new Error("Analysis job not found.");
    if (job.status === "completed") return structuredClone(job);
    const next = { ...job, status: "cancelled" as const, updatedAt: new Date().toISOString() };
    browserAnalysisJobs.set(projectPath, [
      next,
      ...(browserAnalysisJobs.get(projectPath) ?? []).filter((item) => item.id !== jobId)
    ]);
    return structuredClone(next);
  },
  async indexChapter(projectPath: string, input: IndexChapterInput) {
    const content = input.content ?? input.text ?? "";
    const hash = browserHash(content);
    const chunk = {
      id: `browser-chunk-${input.chapterId}-0`,
      chapterId: input.chapterId,
      chapterTitle: input.title || input.chapterId,
      chunkIndex: 0,
      startOffset: 0,
      endOffset: content.length,
      text: content,
      contentHash: hash,
      chapterContentHash: hash,
      vector: [],
      sceneId: input.scenes?.[0]?.id,
      sceneTitle: input.scenes?.[0]?.title
    };
    const current = browserChunkIndexes.get(projectPath) ?? [];
    const next = [chunk, ...current.filter((item) => item.chapterId !== input.chapterId)];
    browserChunkIndexes.set(projectPath, next);
    return {
      chapterId: input.chapterId,
      changed: true,
      contentHash: hash,
      chunks: [chunk],
      indexedChunks: 1,
      totalChunks: next.length,
      generation: next.length
    };
  },
  async indexProject(inputOrProject: IndexProjectInput | string) {
    const input: IndexProjectInput =
      typeof inputOrProject === "string"
        ? {
            projectPath: inputOrProject,
            chapters: browserProjectChapters(inputOrProject).map((chapter) => ({
              chapterId: chapter.id,
              title: chapter.title,
              content: getProjectRecord(inputOrProject).chapterBodies[chapter.file] ?? "",
              chapterNumber: chapter.number
            }))
          }
        : inputOrProject;
    const results = [];
    for (const chapter of input.chapters) results.push(await this.indexChapter(input.projectPath, chapter));
    return results;
  },
  async getChunkIndexStats(projectPath: string) {
    const chunks = browserChunkIndexes.get(projectPath) ?? [];
    const chapters = new Set(chunks.map((item) => item.chapterId)).size;
    return {
      generation: chunks.length,
      chapters,
      chunks: chunks.length,
      chapterCount: chapters,
      chunkCount: chunks.length,
      embeddingProviderId: "browser-mock",
      embeddingDimensions: 0
    };
  },
  async searchContinuation(
    projectPath: string,
    query: string,
    options?: import("../../electron/services/HybridRetriever.js").HybridRetrieveOptions
  ) {
    const chunks = browserChunkIndexes.get(projectPath) ?? [];
    const needle = query.trim().toLocaleLowerCase("zh-CN");
    const limit = Math.max(1, Math.min(100, Math.trunc(options?.limit ?? 20)));
    const hits = !needle
      ? []
      : chunks
          .filter((chunk) => `${chunk.chapterTitle}\n${chunk.text}`.toLocaleLowerCase("zh-CN").includes(needle))
          .slice(0, limit)
          .map((chunk) => {
            const offset = chunk.text.toLocaleLowerCase("zh-CN").indexOf(needle);
            const excerpt = chunk.text.slice(
              Math.max(0, offset - 120),
              Math.min(chunk.text.length, offset + needle.length + 240)
            );
            const source = {
              chapterId: chunk.chapterId,
              sceneId: chunk.sceneId,
              startOffset: chunk.startOffset + Math.max(0, offset - 120),
              endOffset: chunk.startOffset + Math.max(0, offset - 120) + excerpt.length,
              excerpt,
              contentHash: chunk.contentHash
            };
            return {
              id: chunk.id,
              chunkId: chunk.id,
              chapterId: chunk.chapterId,
              chapterTitle: chunk.chapterTitle,
              sceneId: chunk.sceneId,
              score: 1,
              lexicalScore: 1,
              semanticScore: 0,
              mode: "lexical" as const,
              retrievalMode: "lexical" as const,
              snippet: excerpt,
              source,
              evidence: source,
              chunkStartOffset: chunk.startOffset,
              chunkEndOffset: chunk.endOffset,
              contentHash: chunk.contentHash
            };
          });
    return {
      hits,
      mode: "lexical" as const,
      retrievalMode: "lexical" as const,
      semanticAvailable: false,
      indexedChunks: chunks.length,
      query: query.trim()
    };
  },
  async listCanonFacts(projectPath: string, filter?: import("../../electron/services/CanonStore.js").CanonFactFilter) {
    return structuredClone(
      (browserCanonFacts.get(projectPath) ?? []).filter((fact) => {
        if (filter?.id && fact.id !== filter.id) return false;
        if (filter?.subjectId && fact.subjectId !== filter.subjectId) return false;
        if (filter?.predicate && fact.predicate !== filter.predicate) return false;
        if (filter?.status && !(Array.isArray(filter.status) ? filter.status : [filter.status]).includes(fact.status))
          return false;
        return !(filter?.authorLockedOnly && fact.status !== "author_locked");
      })
    );
  },
  async saveCanonFact(inputOrProject: SaveCanonFactInput | string, fact?: CanonFact) {
    const input: SaveCanonFactInput =
      typeof inputOrProject === "string" ? { projectPath: inputOrProject, fact: fact! } : inputOrProject;
    const parsed = CanonFactSchema.parse(input.fact);
    const current = browserCanonFacts.get(input.projectPath) ?? [];
    browserCanonFacts.set(input.projectPath, [...current.filter((fact) => fact.id !== parsed.id), parsed]);
    return structuredClone(parsed);
  },
  async setCanonFactStatus(projectPath: string, factId: string, status: CanonFactStatus) {
    const current = browserCanonFacts.get(projectPath) ?? [];
    const fact = current.find((item) => item.id === factId);
    if (!fact) throw new Error("Canon fact not found.");
    const parsed = CanonFactSchema.parse({ ...fact, status, updatedAt: new Date().toISOString() });
    browserCanonFacts.set(
      projectPath,
      current.map((item) => (item.id === factId ? parsed : item))
    );
    return structuredClone(parsed);
  },
  async listStoryThreads(
    projectPath: string,
    filter?: import("../../electron/services/StoryThreadService.js").StoryThreadFilter
  ) {
    return structuredClone(
      (browserStoryThreads.get(projectPath) ?? []).filter((thread) => {
        if (filter?.id && thread.id !== filter.id) return false;
        if (filter?.locked !== undefined && thread.locked !== filter.locked) return false;
        if (filter?.type && !(Array.isArray(filter.type) ? filter.type : [filter.type]).includes(thread.type))
          return false;
        if (filter?.status && !(Array.isArray(filter.status) ? filter.status : [filter.status]).includes(thread.status))
          return false;
        return true;
      })
    );
  },
  async saveStoryThread(inputOrProject: SaveStoryThreadInput | string, thread?: StoryThread) {
    const input: SaveStoryThreadInput =
      typeof inputOrProject === "string" ? { projectPath: inputOrProject, thread: thread! } : inputOrProject;
    const parsed = StoryThreadSchema.parse(input.thread);
    const current = browserStoryThreads.get(input.projectPath) ?? [];
    browserStoryThreads.set(input.projectPath, [...current.filter((thread) => thread.id !== parsed.id), parsed]);
    return structuredClone(parsed);
  },
  async setStoryThreadStatus(projectPath: string, threadId: string, status: StoryThreadStatus) {
    const current = browserStoryThreads.get(projectPath) ?? [];
    const thread = current.find((item) => item.id === threadId);
    if (!thread) throw new Error("Story thread not found.");
    const parsed = StoryThreadSchema.parse({ ...thread, status, updatedAt: new Date().toISOString() });
    browserStoryThreads.set(
      projectPath,
      current.map((item) => (item.id === threadId ? parsed : item))
    );
    return structuredClone(parsed);
  },
  async analyzeStyleProfile(projectPath: string, options?: { chapterIds?: string[]; maxExemplarsPerType?: number }) {
    const chapters = browserProjectChapters(projectPath).filter(
      (chapter) => !chapter.archived && (!options?.chapterIds?.length || options.chapterIds.includes(chapter.id))
    );
    const profile = browserEnsureStyle(projectPath);
    const exemplars: Record<
      string,
      Array<{ chapterId: string; startOffset: number; endOffset: number; excerpt: string; contentHash: string }>
    > = { narrative: [], dialogue: [] };
    let chars = 0;
    let dialogue = 0;
    const sourceChapterHashes: Record<string, string> = {};
    for (const chapter of chapters) {
      const content = getProjectRecord(projectPath).chapterBodies[chapter.file] ?? "";
      if (!content.trim()) continue;
      chars += content.length;
      dialogue += (content.match(/[“”「」『』]/gu) ?? []).length;
      const hash = browserHash(content);
      sourceChapterHashes[chapter.id] = hash;
      const excerpt = content.slice(0, 420);
      const kind = dialogue >= 0.18 ? "dialogue" : "narrative";
      if ((exemplars[kind]?.length ?? 0) < Math.max(1, Math.min(12, options?.maxExemplarsPerType ?? 4))) {
        exemplars[kind].push({
          chapterId: chapter.id,
          startOffset: 0,
          endOffset: excerpt.length,
          excerpt,
          contentHash: hash
        });
      }
    }
    const next = StyleProfileSchema.parse({
      ...profile,
      version: profile.version + 1,
      sentenceLengthMean: chars ? Math.max(1, Math.round(chars / Math.max(1, chapters.length))) : 0,
      paragraphLengthMean: chars ? Math.max(1, Math.round(chars / Math.max(1, chapters.length))) : 0,
      dialogueRatio: chars ? Math.min(1, dialogue / chars) : 0,
      sourceChapterHashes,
      sceneExemplars: exemplars,
      evidence: [...exemplars.narrative, ...exemplars.dialogue],
      updatedAt: new Date().toISOString()
    });
    browserStyleProfiles.set(projectPath, next);
    return {
      profile: structuredClone(next),
      analyzedChapters: chapters.length,
      analyzedCharacters: chars,
      skippedChapters: []
    };
  },
  async loadStyleProfile(projectPath: string) {
    return browserStyleProfiles.get(projectPath) ? structuredClone(browserStyleProfiles.get(projectPath)) : undefined;
  },
  async evaluateStyle(projectPath: string, text: string, tolerance = 0.35) {
    const profile = browserStyleProfiles.get(projectPath);
    if (!profile) throw new Error("Please analyze a style profile first.");
    const baseline = profile.dialogueRatio ?? 0;
    const actual = text.length ? (text.match(/[“”「」『』]/gu) ?? []).length / text.length : 0;
    const relativeDelta = baseline ? Math.abs(actual - baseline) / baseline : actual;
    const score = Math.max(0, Math.round(100 - Math.min(1, relativeDelta / Math.max(0.01, tolerance)) * 100));
    return {
      score,
      warnings: score < 70 ? ["Dialogue ratio differs from the stored baseline."] : [],
      deltas: [
        {
          metric: "dialogueRatio",
          baseline,
          actual,
          relativeDelta,
          severity: score < 70 ? ("warning" as const) : ("info" as const)
        }
      ]
    };
  },
  async compileContinuationContext(input: import("../../electron/services/ContextCompiler.js").CompileContextInput) {
    const contract = ChapterContractSchema.parse(input.contract);
    const chapters = browserProjectChapters(input.projectPath);
    const chapterIndex = chapters.findIndex((chapter) => chapter.id === input.chapterId);
    const previous = chapterIndex > 0 ? chapters[chapterIndex - 1] : undefined;
    const previousContent = previous ? (getProjectRecord(input.projectPath).chapterBodies[previous.file] ?? "") : "";
    const immediateContinuity =
      previous && previousContent.trim()
        ? [
            {
              chapterId: previous.id,
              startOffset: Math.max(0, previousContent.length - 1800),
              endOffset: previousContent.length,
              excerpt: previousContent.slice(-1800),
              contentHash: browserHash(previousContent)
            }
          ]
        : [];
    const facts = await this.listCanonFacts(input.projectPath);
    const threads = await this.listStoryThreads(input.projectPath);
    const retrieval = await this.searchContinuation(
      input.projectPath,
      [input.instruction, contract.title, ...contract.mustHappen].filter(Boolean).join(" "),
      { limit: input.retrievalLimit ?? 20 }
    );
    const profile = browserStyleProfiles.get(input.projectPath);
    const tokenUsageBySection = {
      hardConstraints: 0,
      immediateContinuity: immediateContinuity.length,
      activeCharacterStates: 0,
      dueThreads: threads.length,
      retrievedEvidence: retrieval.hits.length,
      styleExemplars: profile?.evidence.length ?? 0,
      chapterContract: 1
    };
    return EvidencePackSchema.parse({
      hardConstraints: facts.filter((fact) => fact.status === "author_locked"),
      immediateContinuity,
      chapterContract: contract,
      activeCharacterStates: facts.filter((fact) => fact.status !== "rejected"),
      dueThreads: threads,
      retrievedEvidence: retrieval.hits.map((hit) => hit.evidence),
      styleExemplars: profile?.evidence ?? [],
      exclusions: [],
      tokenUsageBySection,
      omittedSections: [],
      generatedAt: new Date().toISOString(),
      query: input.instruction ?? contract.title
    });
  },
  async listContinuationRuns(projectPath: string, chapterId?: string) {
    return structuredClone(
      (browserContinuationRuns.get(projectPath) ?? []).filter((run) => !chapterId || run.chapterId === chapterId)
    );
  },
  async startContinuationRun(input: ContinuationRunInput): Promise<ContinuationRunResult> {
    const contract = ChapterContractSchema.parse(input.contract);
    const now = new Date().toISOString();
    const id = input.runId?.trim() || `browser-run-${Date.now()}`;
    const evidencePack = await this.compileContinuationContext({
      projectPath: input.projectPath,
      chapterId: input.chapterId,
      contract,
      instruction: input.instruction,
      tokenBudget: input.tokenBudget,
      retrievalLimit: input.retrievalLimit
    });
    const draft = `${input.instruction?.trim() || "继续推进本章冲突"}\n\n（浏览器演示草稿：请在桌面版生成并审阅正文。）`;
    const run: ContinuationRun = {
      schemaVersion: 1,
      id,
      projectPath: input.projectPath,
      chapterId: input.chapterId,
      contract,
      instruction: input.instruction ?? "",
      status: "completed",
      checkpoint: { phase: "completed", updatedAt: now, message: "Browser demo run completed." },
      evidencePack,
      draft,
      validation: { canApply: true, hardFailures: 0, softWarnings: 0, findings: [] },
      createdAt: now,
      updatedAt: now
    };
    const runs = browserContinuationRuns.get(input.projectPath) ?? [];
    browserContinuationRuns.set(input.projectPath, [run, ...runs.filter((item) => item.id !== id)]);
    return {
      run: structuredClone(run),
      id,
      status: run.status,
      projectPath: run.projectPath,
      chapterId: run.chapterId,
      checkpoint: run.checkpoint,
      evidencePack,
      validation: run.validation,
      draft
    };
  },
  async retryContinuationRun(projectPath, runId, options = {}) {
    const previous = (browserContinuationRuns.get(projectPath) ?? []).find((run) => run.id === runId);
    if (!previous) throw new Error("续写运行不存在。");
    return this.startContinuationRun({
      projectPath,
      chapterId: previous.chapterId,
      contract: previous.contract,
      instruction: options.instruction ?? previous.instruction
    });
  },
  async cancelContinuationRun(projectPath, runId) {
    const runs = browserContinuationRuns.get(projectPath) ?? [];
    const previous = runs.find((run) => run.id === runId);
    if (!previous) throw new Error("续写运行不存在。");
    const cancelled: ContinuationRun = {
      ...previous,
      status: "cancelled",
      checkpoint: { phase: "cancelled", updatedAt: new Date().toISOString(), message: "Cancelled." },
      updatedAt: new Date().toISOString()
    };
    browserContinuationRuns.set(
      projectPath,
      runs.map((run) => (run.id === runId ? cancelled : run))
    );
    return structuredClone(cancelled);
  },
  async listProviderPresets() {
    return structuredClone(browserProviderPresets);
  },
  async probeProvider(role) {
    assertProviderRole(role);
    const provider = resolveProvider(readProviderStorage(), role);
    const startedAt = Date.now();
    const checkedAt = new Date().toISOString();
    let modelReachable = false;
    try {
      if (!hasAuthMaterial(provider.authMode, provider.apiKey ?? "")) throw new Error("请先配置此用途的模型。");
      const signal = AbortSignal.timeout(30_000);
      const request = async (tools = false) => {
        const response = await fetch("/__inkforge_ai/chat-completions", {
          method: "POST",
          signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            baseUrl: provider.baseUrl,
            authMode: provider.authMode,
            apiKey: provider.apiKey,
            payload: {
              model: provider.model,
              temperature: 0,
              max_tokens: Math.min(provider.maxTokens, tools ? 256 : 64),
              stream: false,
              messages: [{ role: "user", content: tools ? "Call capability_probe." : "Reply with OK." }],
              ...(tools
                ? {
                    tools: [
                      {
                        type: "function",
                        function: {
                          name: "capability_probe",
                          description: "Probe",
                          parameters: { type: "object", properties: {} }
                        }
                      }
                    ],
                    tool_choice: "auto"
                  }
                : {})
            }
          })
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(`模型探测失败（HTTP ${response.status}）。`);
        return payload;
      };
      const text = await request();
      if (!text.choices?.[0]?.message?.content?.trim()) throw new Error("模型未返回有效文本。");
      modelReachable = true;
      let tools = false;
      if (provider.supportsTools !== false) {
        try {
          tools = Boolean(
            (await request(true)).choices?.[0]?.message?.tool_calls?.some(
              (call: { function?: { name?: string } }) => call.function?.name === "capability_probe"
            )
          );
        } catch {
          /* Text generation remains usable. */
        }
      }
      return {
        ok: true,
        checkedAt,
        latencyMs: Date.now() - startedAt,
        modelReachable,
        model: provider.model,
        providerRole: role,
        capabilities: { tools },
        message: `文本生成已验证。${tools ? "工具调用已验证。" : "工具调用未验证。"}流式能力待实际生成验证。`
      };
    } catch (error) {
      return {
        ok: false,
        checkedAt,
        latencyMs: Date.now() - startedAt,
        modelReachable,
        model: provider.model,
        providerRole: role,
        capabilities: { tools: false },
        message: error instanceof Error ? error.message : String(error)
      };
    }
  },
  async getReleaseReadiness(projectPath) {
    const record = getProjectRecord(projectPath);
    const chapters = record.summary.outline.volumes
      .flatMap((volume) => volume.chapters)
      .filter((chapter) => !chapter.archived);
    const covered = new Set(browserQualityReports.map((report) => report.chapterId)).size;
    const pending = browserBranches.filter((branch) => branch.status === "draft").length;
    const provider = providerStatusFromStorage(readProviderStorage());
    const configuredProviders = [provider, ...Object.values(provider.taskProviders ?? {})].filter(
      (endpoint) => endpoint.configured
    );
    const items = [
      { id: "project-shape", label: "项目结构", status: "ready" as const, detail: "核心项目文件齐全。" },
      {
        id: "provider",
        label: "模型配置",
        status: configuredProviders.length ? ("ready" as const) : ("warning" as const),
        detail: configuredProviders.length
          ? configuredProviders.map((endpoint) => endpoint.model).join("；")
          : "尚未配置可用模型。"
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

const browserProviderPresets: import("../../electron/types").ProviderPreset[] = [
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
    id: "inkforge-writer-9b",
    displayName: "InkForge 9B 写手",
    category: "local",
    description: "连接已部署的小说模型服务；模型名称需与服务实际提供的名称一致。",
    baseUrl: "http://127.0.0.1:8000/v1",
    model: "inkforge-writer-9b",
    authMode: "none",
    expectedCapabilities: { streaming: true, tools: false }
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
      // Keep the browser mirror usable while an older preload is running. A
      // newly added API can therefore be exercised in the web demo without
      // turning a missing Electron method into a hard failure.
      return browserValue.bind(target);
    }
    return browserValue;
  }
}) as InkforgeApi;
