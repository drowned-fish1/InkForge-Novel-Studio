import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type {
  AgentChangeResolutionInput,
  AgentDataResolutionInput,
  AgentChatInput,
  AgentSessionCommandInput,
  AgentRunEvent,
  AnalysisJob,
  AnalysisJobStartInput,
  CreateBatchRunInput,
  CreateChapterInput,
  CreateProjectInput,
  CreateStoryBranchInput,
  ExportInput,
  CorpusImportManifest,
  CorpusImportStartInput,
  ImportProgress,
  AdoptCorpusInput,
  CorpusAdoptionResult,
  IndexChapterInput,
  IndexProjectInput,
  AiTaskInput,
  AiTaskResult,
  PlanningAiInput,
  PlanningImportResult,
  PlanningImportSelection,
  PlanningSession,
  PipelinePresetSummary,
  PipelineRunView,
  PipelineStartInput,
  InkforgeApi,
  ProviderConfigInput,
  ProjectSummary,
  ProviderStatus,
  SaveChapterInput,
  SaveChapterSummaryInput,
  SaveCanonFactInput,
  SaveStoryThreadInput,
  SaveStoryBranchInput,
  SaveCharacterInput,
  SaveClueInput,
  SaveTermInput,
  SaveTimelineEventInput,
  SaveWorldEntryInput,
  SimulationRunEvent,
  SimulationRunInput,
  UpdateOutlineInput,
  WritingSessionCommandInput,
  WritingSessionState
} from "./types.js";

const createRequestId = (prefix: string): string => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;

const createAbortError = (): Error => {
  const error = new Error("Request cancelled.");
  error.name = "AbortError";
  return error;
};

const invokeWithAbort = async <T, Input extends { requestId?: string }, Delta = string>(
  channel: string,
  cancelChannel: string,
  input: Input,
  signal: AbortSignal | undefined,
  requestPrefix: string,
  delta?: {
    channel: string;
    onDelta: (payload: Delta) => void;
  }
): Promise<T> => {
  const requestId = input.requestId ?? createRequestId(requestPrefix);
  const usableSignal =
    signal && typeof signal.addEventListener === "function" && typeof signal.removeEventListener === "function"
      ? signal
      : undefined;
  if (usableSignal?.aborted) {
    throw createAbortError();
  }

  let settled = false;
  const cancel = () => {
    if (!settled) {
      void ipcRenderer.invoke(cancelChannel, requestId);
    }
  };
  usableSignal?.addEventListener("abort", cancel, { once: true });
  const handleDelta = (_event: IpcRendererEvent, deltaRequestId: string, payload: Delta) => {
    if (deltaRequestId === requestId) {
      delta?.onDelta(payload);
    }
  };
  if (delta) {
    ipcRenderer.on(delta.channel, handleDelta);
  }

  try {
    return await ipcRenderer.invoke(channel, { ...input, requestId });
  } catch (error) {
    if (usableSignal?.aborted) {
      throw createAbortError();
    }
    throw error;
  } finally {
    settled = true;
    usableSignal?.removeEventListener("abort", cancel);
    if (delta) {
      ipcRenderer.removeListener(delta.channel, handleDelta);
    }
  }
};

const invokeWithProgress = async <T, Progress>(
  channel: string,
  progressChannel: string,
  input: unknown,
  key: string,
  onProgress?: (progress: Progress) => void
): Promise<T> => {
  const listener = (_event: IpcRendererEvent, progressKey: string, progress: Progress) => {
    if (!key || progressKey === key) onProgress?.(progress);
  };
  if (onProgress) ipcRenderer.on(progressChannel, listener);
  try {
    return await ipcRenderer.invoke(channel, input);
  } finally {
    if (onProgress) ipcRenderer.removeListener(progressChannel, listener);
  }
};

const api: InkforgeApi = {
  setTheme: async (theme: "light" | "dark", manual = false): Promise<void> => {
    ipcRenderer.send("theme:set", theme, manual);
  },
  listProjects: () => ipcRenderer.invoke("project:list"),
  createProject: (input: CreateProjectInput): Promise<ProjectSummary | undefined> =>
    ipcRenderer.invoke("project:create", input),
  openProject: (projectPath?: string): Promise<ProjectSummary | undefined> =>
    ipcRenderer.invoke("project:open", projectPath),
  importProjectFolder: (): Promise<ProjectSummary | undefined> => ipcRenderer.invoke("project:open"),
  revealProject: (projectPath?: string): Promise<void> =>
    projectPath ? ipcRenderer.invoke("project:reveal", projectPath) : Promise.resolve(),
  readChapter: (projectPath: string, file: string): Promise<string> =>
    ipcRenderer.invoke("chapter:read", projectPath, file),
  saveChapter: (input: SaveChapterInput): Promise<void> => ipcRenderer.invoke("chapter:save", input),
  listChapterHistory: (projectPath: string, file: string) =>
    ipcRenderer.invoke("chapter:history:list", projectPath, file),
  readChapterHistory: (projectPath: string, file: string, historyId: string) =>
    ipcRenderer.invoke("chapter:history:read", projectPath, file, historyId),
  restoreChapterHistory: (projectPath: string, file: string, historyId: string) =>
    ipcRenderer.invoke("chapter:history:restore", projectPath, file, historyId),
  createChapter: (input: CreateChapterInput): Promise<ProjectSummary> => ipcRenderer.invoke("chapter:create", input),
  updateOutline: (input: UpdateOutlineInput): Promise<ProjectSummary> => ipcRenderer.invoke("outline:update", input),
  exportManuscript: (input: ExportInput): Promise<string | undefined> => ipcRenderer.invoke("export:manuscript", input),
  loadExportConfig: (projectPath) => ipcRenderer.invoke("export:config:load", projectPath),
  saveExportConfig: (projectPath, config) => ipcRenderer.invoke("export:config:save", projectPath, config),
  exportPreflight: (projectPath) => ipcRenderer.invoke("export:preflight", projectPath),
  chooseCoverImage: () => ipcRenderer.invoke("export:choose-cover"),
  listBackups: (projectPath) => ipcRenderer.invoke("backup:list", projectPath),
  inspectBackups: (projectPath) => ipcRenderer.invoke("backup:inspect", projectPath),
  createBackup: (projectPath, label) => ipcRenderer.invoke("backup:create", projectPath, label),
  restoreBackup: (projectPath, snapshotId) => ipcRenderer.invoke("backup:restore", projectPath, snapshotId),
  deleteBackup: (projectPath, snapshotId) => ipcRenderer.invoke("backup:delete", projectPath, snapshotId),
  verifyBackup: (projectPath, snapshotId) => ipcRenderer.invoke("backup:verify", projectPath, snapshotId),
  diffBackup: (projectPath, snapshotId) => ipcRenderer.invoke("backup:diff", projectPath, snapshotId),
  readBackupFile: (projectPath, snapshotId, file) =>
    ipcRenderer.invoke("backup:read-file", projectPath, snapshotId, file),
  loadBackupSettings: (projectPath) => ipcRenderer.invoke("backup:settings:load", projectPath),
  saveBackupSettings: (projectPath, settings) => ipcRenderer.invoke("backup:settings:save", projectPath, settings),
  chooseBackupDirectory: () => ipcRenderer.invoke("backup:choose-directory"),
  inspectProjectFolder: (projectPath) => ipcRenderer.invoke("project:inspect", projectPath),
  chooseProjectFolder: () => ipcRenderer.invoke("project:choose-folder"),
  listChapterHistoryOverview: (projectPath, files) =>
    ipcRenderer.invoke("chapter:history:overview", projectPath, files),
  loadWritingWorkspace: (projectPath) => ipcRenderer.invoke("writing-workspace:load", projectPath),
  saveWritingWorkspace: (projectPath, state) => ipcRenderer.invoke("writing-workspace:save", projectPath, state),
  loadAgentExtensions: (projectPath) => ipcRenderer.invoke("agent-extensions:load", projectPath),
  saveAgentExtensions: (projectPath, config) => ipcRenderer.invoke("agent-extensions:save", projectPath, config),
  listCharacters: (projectPath: string) => ipcRenderer.invoke("library:characters:list", projectPath),
  saveCharacter: (input: SaveCharacterInput) => ipcRenderer.invoke("library:characters:save", input),
  listWorldEntries: (projectPath: string) => ipcRenderer.invoke("library:world:list", projectPath),
  saveWorldEntry: (input: SaveWorldEntryInput) => ipcRenderer.invoke("library:world:save", input),
  providerStatus: (): Promise<ProviderStatus> => ipcRenderer.invoke("provider:status"),
  saveProviderConfig: (input: ProviderConfigInput): Promise<ProviderStatus> =>
    ipcRenderer.invoke("provider:save", input),
  runAiTask: (input: AiTaskInput, signal?: AbortSignal, onDelta?: (chunk: string) => void): Promise<AiTaskResult> =>
    invokeWithAbort(
      "ai:run-task",
      "ai:cancel",
      input,
      signal,
      "ai",
      onDelta ? { channel: "ai:task-delta", onDelta } : undefined
    ),
  cancelAiTask: (requestId: string): Promise<void> => ipcRenderer.invoke("ai:cancel", requestId),
  saveChapterSummary: (input: SaveChapterSummaryInput): Promise<string> => ipcRenderer.invoke("summary:save", input),
  listChapterSummaries: (projectPath: string) => ipcRenderer.invoke("summary:list", projectPath),
  listTimeline: (projectPath: string) => ipcRenderer.invoke("story:timeline:list", projectPath),
  saveTimelineEvent: (input: SaveTimelineEventInput) => ipcRenderer.invoke("story:timeline:save", input),
  listClues: (projectPath: string) => ipcRenderer.invoke("story:clues:list", projectPath),
  saveClue: (input: SaveClueInput) => ipcRenderer.invoke("story:clues:save", input),
  listTerms: (projectPath: string) => ipcRenderer.invoke("story:terms:list", projectPath),
  saveTerm: (input: SaveTermInput) => ipcRenderer.invoke("story:terms:save", input),
  listConflicts: (projectPath) => ipcRenderer.invoke("story:conflicts:list", projectPath),
  saveConflict: (input) => ipcRenderer.invoke("story:conflicts:save", input),
  findEntityReferences: (projectPath, target) => ipcRenderer.invoke("story:entity:references", projectPath, target),
  searchProject: (projectPath, query) => ipcRenderer.invoke("project:search", projectPath, query),
  revisionOverview: (projectPath) => ipcRenderer.invoke("revision:overview", projectPath),
  setRevisionDisposition: (projectPath, key, status, note) =>
    ipcRenderer.invoke("revision:disposition:set", projectPath, key, status, note),
  deleteStoryEntity: (projectPath, target, mode, replacement) =>
    ipcRenderer.invoke("story:entity:delete", projectPath, target, mode, replacement),
  inspectStory: (projectPath: string) => ipcRenderer.invoke("story:inspect", projectPath),
  listPlanningSessions: (projectPath: string): Promise<PlanningSession[]> =>
    ipcRenderer.invoke("planning:list", projectPath),
  savePlanningSession: (projectPath: string, session: PlanningSession): Promise<PlanningSession[]> =>
    ipcRenderer.invoke("planning:save", projectPath, session),
  runPlanningAi: (input: PlanningAiInput, signal?: AbortSignal): Promise<PlanningSession> =>
    invokeWithAbort("planning:run-ai", "planning:cancel", input, signal, "planning"),
  cancelPlanningAi: (requestId: string): Promise<void> => ipcRenderer.invoke("planning:cancel", requestId),
  importPlanningPackage: (
    projectPath: string,
    sessionId: string,
    selection: PlanningImportSelection
  ): Promise<PlanningImportResult> => ipcRenderer.invoke("planning:import", projectPath, sessionId, selection),
  restorePlanningSnapshot: (projectPath: string, snapshotId: string): Promise<PlanningImportResult> =>
    ipcRenderer.invoke("planning:restore-snapshot", projectPath, snapshotId),
  listPipelinePresets: (): Promise<PipelinePresetSummary[]> => ipcRenderer.invoke("agent:pipeline:list"),
  startPipeline: (input: PipelineStartInput): Promise<PipelineRunView> =>
    ipcRenderer.invoke("agent:pipeline:start", input),
  confirmPipelineStep: (): Promise<PipelineRunView> => ipcRenderer.invoke("agent:pipeline:confirm"),
  pausePipeline: (): Promise<PipelineRunView> => ipcRenderer.invoke("agent:pipeline:pause"),
  cancelPipeline: (): Promise<PipelineRunView> => ipcRenderer.invoke("agent:pipeline:cancel"),
  skipPipelineStep: (): Promise<PipelineRunView> => ipcRenderer.invoke("agent:pipeline:skip"),
  retryPipelineStep: (): Promise<PipelineRunView> => ipcRenderer.invoke("agent:pipeline:retry"),
  runWritingSessionCommand: (input: WritingSessionCommandInput): Promise<WritingSessionState> =>
    ipcRenderer.invoke("agent:writing:command", input),
  loadAgentChat: (projectPath: string, chapterId: string) =>
    ipcRenderer.invoke("agent:chat:load", projectPath, chapterId),
  estimateAgentRun: (input) => ipcRenderer.invoke("agent:chat:estimate", input),
  approveAgentTool: (requestId, callId, approved) =>
    ipcRenderer.invoke("agent:chat:approve-tool", requestId, callId, approved),
  runAgentChat: (input: AgentChatInput, signal?: AbortSignal, onEvent?: (event: AgentRunEvent) => void) =>
    invokeWithAbort(
      "agent:chat:run",
      "agent:chat:cancel",
      input,
      signal,
      "agent-chat",
      onEvent ? { channel: "agent:chat:event", onDelta: onEvent } : undefined
    ),
  cancelAgentChat: (requestId: string): Promise<void> => ipcRenderer.invoke("agent:chat:cancel", requestId),
  listAgentTraces: (projectPath: string, chapterId: string) =>
    ipcRenderer.invoke("agent:chat:traces", projectPath, chapterId),
  resolveAgentChange: (input: AgentChangeResolutionInput) => ipcRenderer.invoke("agent:chat:resolve-change", input),
  resolveAgentDataChange: (input: AgentDataResolutionInput) => ipcRenderer.invoke("agent:chat:resolve-data", input),
  manageAgentSession: (input: AgentSessionCommandInput) => ipcRenderer.invoke("agent:chat:session", input),
  listScenePlans: (projectPath: string, chapterId: string) =>
    ipcRenderer.invoke("agent:scenes:list", projectPath, chapterId),
  saveScenePlans: (projectPath, chapterId, scenes) =>
    ipcRenderer.invoke("agent:scenes:save", projectPath, chapterId, scenes),
  evaluateChapterQuality: (projectPath, chapterId) => ipcRenderer.invoke("quality:evaluate", projectPath, chapterId),
  evaluateProjectQuality: (projectPath) => ipcRenderer.invoke("quality:evaluate-all", projectPath),
  listChapterQualityReports: (projectPath, chapterId) => ipcRenderer.invoke("quality:list", projectPath, chapterId),
  setChapterQualityBaseline: (projectPath, chapterId, reportId) =>
    ipcRenderer.invoke("quality:baseline", projectPath, chapterId, reportId),
  listStoryBranches: (projectPath, chapterId) => ipcRenderer.invoke("branch:list", projectPath, chapterId),
  createStoryBranch: (input: CreateStoryBranchInput) => ipcRenderer.invoke("branch:create", input),
  saveStoryBranch: (input: SaveStoryBranchInput) => ipcRenderer.invoke("branch:save", input),
  compareStoryBranch: (projectPath, branchId) => ipcRenderer.invoke("branch:compare", projectPath, branchId),
  applyStoryBranch: (projectPath, branchId) => ipcRenderer.invoke("branch:apply", projectPath, branchId),
  archiveStoryBranch: (projectPath, branchId) => ipcRenderer.invoke("branch:archive", projectPath, branchId),
  listBatchRuns: (projectPath) => ipcRenderer.invoke("batch:list", projectPath),
  createBatchRun: (input: CreateBatchRunInput) => ipcRenderer.invoke("batch:create", input),
  resumeBatchRun: (projectPath, runId) => ipcRenderer.invoke("batch:resume", projectPath, runId),
  cancelBatchRun: (projectPath, runId) => ipcRenderer.invoke("batch:cancel", projectPath, runId),
  listProviderPresets: () => ipcRenderer.invoke("provider:presets"),
  probeProvider: () => ipcRenderer.invoke("provider:probe"),
  getReleaseReadiness: (projectPath) => ipcRenderer.invoke("release:readiness", projectPath),
  loadBeatBoard: (projectPath) => ipcRenderer.invoke("narrative:board:load", projectPath),
  saveBeatBoard: (projectPath, board) => ipcRenderer.invoke("narrative:board:save", projectPath, board),
  exportPlayable: (input) => ipcRenderer.invoke("narrative:export", input),
  listSimulations: (projectPath) => ipcRenderer.invoke("simulation:list", projectPath),
  saveSimulationScenario: (projectPath, scenario) => ipcRenderer.invoke("simulation:save", projectPath, scenario),
  runSimulation: (input: SimulationRunInput, signal?: AbortSignal, onEvent?: (event: SimulationRunEvent) => void) =>
    invokeWithAbort(
      "simulation:run",
      "simulation:cancel",
      input,
      signal,
      "simulation",
      onEvent ? { channel: "simulation:event", onDelta: onEvent } : undefined
    ),
  cancelSimulation: (requestId) => ipcRenderer.invoke("simulation:cancel", requestId),
  chooseCorpusSource: (): Promise<string | undefined> => ipcRenderer.invoke("continuation:choose-source"),
  startCorpusImport: (
    input: CorpusImportStartInput,
    onProgress?: (progress: ImportProgress) => void
  ): Promise<CorpusImportManifest> =>
    invokeWithProgress(
      "continuation:import:start",
      "continuation:import:progress",
      input,
      input.importId ?? "",
      onProgress
    ),
  listCorpusImports: (projectPath: string): Promise<CorpusImportManifest[]> =>
    ipcRenderer.invoke("continuation:import:list", projectPath),
  pauseCorpusImport: (projectPath: string, importId: string): Promise<CorpusImportManifest> =>
    ipcRenderer.invoke("continuation:import:pause", projectPath, importId),
  resumeCorpusImport: (
    projectPath: string,
    importId: string,
    onProgress?: (progress: ImportProgress) => void
  ): Promise<CorpusImportManifest> =>
    invokeWithProgress(
      "continuation:import:resume",
      "continuation:import:progress",
      {
        projectPath,
        importId
      },
      importId,
      onProgress
    ),
  cancelCorpusImport: (projectPath: string, importId: string): Promise<CorpusImportManifest> =>
    ipcRenderer.invoke("continuation:import:cancel", projectPath, importId),
  adoptCorpusImport: (input: AdoptCorpusInput): Promise<CorpusAdoptionResult> =>
    ipcRenderer.invoke("continuation:adopt", input),
  startAnalysisJob: (
    input: AnalysisJobStartInput,
    onProgress?: (progress: import("./services/ContinuationTypes.js").AnalysisProgress) => void
  ): Promise<AnalysisJob> =>
    invokeWithProgress(
      "continuation:analysis:start",
      "continuation:analysis:progress",
      input,
      input.jobId ?? "",
      onProgress
    ),
  listAnalysisJobs: (projectPath: string): Promise<AnalysisJob[]> =>
    ipcRenderer.invoke("continuation:analysis:list", projectPath),
  pauseAnalysisJob: (projectPath: string, jobId: string): Promise<AnalysisJob> =>
    ipcRenderer.invoke("continuation:analysis:pause", projectPath, jobId),
  resumeAnalysisJob: (
    projectPath: string,
    jobId: string,
    onProgress?: (progress: import("./services/ContinuationTypes.js").AnalysisProgress) => void
  ): Promise<AnalysisJob> =>
    invokeWithProgress(
      "continuation:analysis:resume",
      "continuation:analysis:progress",
      {
        projectPath,
        jobId
      },
      jobId,
      onProgress
    ),
  cancelAnalysisJob: (projectPath: string, jobId: string): Promise<AnalysisJob> =>
    ipcRenderer.invoke("continuation:analysis:cancel", projectPath, jobId),
  indexChapter: (projectPath: string, input: IndexChapterInput) =>
    ipcRenderer.invoke("continuation:index:chapter", projectPath, input),
  indexProject: (input: IndexProjectInput | string) => ipcRenderer.invoke("continuation:index:project", input),
  getChunkIndexStats: (projectPath: string) => ipcRenderer.invoke("continuation:index:stats", projectPath),
  searchContinuation: (
    projectPath: string,
    query: string,
    options?: import("./services/HybridRetriever.js").HybridRetrieveOptions
  ) => ipcRenderer.invoke("continuation:index:search", projectPath, query, options),
  listCanonFacts: (projectPath: string, filter?: import("./services/CanonStore.js").CanonFactFilter) =>
    ipcRenderer.invoke("continuation:canon:list", projectPath, filter),
  saveCanonFact: (inputOrProject: SaveCanonFactInput | string, fact?: import("@inkforge/schemas").CanonFact) =>
    ipcRenderer.invoke(
      "continuation:canon:save",
      typeof inputOrProject === "string" ? { projectPath: inputOrProject, fact } : inputOrProject
    ),
  setCanonFactStatus: (projectPath: string, factId: string, status: import("@inkforge/schemas").CanonFactStatus) =>
    ipcRenderer.invoke("continuation:canon:status", projectPath, factId, status),
  listStoryThreads: (projectPath: string, filter?: import("./services/StoryThreadService.js").StoryThreadFilter) =>
    ipcRenderer.invoke("continuation:threads:list", projectPath, filter),
  saveStoryThread: (inputOrProject: SaveStoryThreadInput | string, thread?: import("@inkforge/schemas").StoryThread) =>
    ipcRenderer.invoke(
      "continuation:threads:save",
      typeof inputOrProject === "string" ? { projectPath: inputOrProject, thread } : inputOrProject
    ),
  setStoryThreadStatus: (
    projectPath: string,
    threadId: string,
    status: import("@inkforge/schemas").StoryThreadStatus
  ) => ipcRenderer.invoke("continuation:threads:status", projectPath, threadId, status),
  analyzeStyleProfile: (projectPath: string, options?: { chapterIds?: string[]; maxExemplarsPerType?: number }) =>
    ipcRenderer.invoke("continuation:style:analyze", projectPath, options),
  loadStyleProfile: (projectPath: string) => ipcRenderer.invoke("continuation:style:load", projectPath),
  evaluateStyle: (projectPath: string, text: string, tolerance?: number) =>
    ipcRenderer.invoke("continuation:style:evaluate", projectPath, text, tolerance),
  compileContinuationContext: (input: import("./services/ContextCompiler.js").CompileContextInput) =>
    ipcRenderer.invoke("continuation:context:compile", input),
  listContinuationRuns: (projectPath: string, chapterId?: string) =>
    ipcRenderer.invoke("continuation:run:list", projectPath, chapterId),
  startContinuationRun: (input: import("./services/ContinuationOrchestrator.js").ContinuationRunInput) =>
    ipcRenderer.invoke("continuation:run:start", input),
  retryContinuationRun: (
    projectPath: string,
    runId: string,
    options?: import("./services/ContinuationOrchestrator.js").ContinuationRetryInput
  ) => ipcRenderer.invoke("continuation:run:retry", projectPath, runId, options),
  cancelContinuationRun: (projectPath: string, runId: string) =>
    ipcRenderer.invoke("continuation:run:cancel", projectPath, runId)
};

contextBridge.exposeInMainWorld("inkforge", api);

export type { InkforgeApi } from "./types.js";
