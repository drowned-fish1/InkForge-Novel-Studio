import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type {
  CreateChapterInput,
  CreateProjectInput,
  ExportInput,
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
  SaveCharacterInput,
  SaveClueInput,
  SaveTermInput,
  SaveTimelineEventInput,
  SaveWorldEntryInput,
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

const invokeWithAbort = async <T, Input extends { requestId?: string }>(
  channel: string,
  cancelChannel: string,
  input: Input,
  signal: AbortSignal | undefined,
  requestPrefix: string,
  delta?: {
    channel: string;
    onDelta: (chunk: string) => void;
  }
): Promise<T> => {
  const requestId = input.requestId ?? createRequestId(requestPrefix);
  if (signal?.aborted) {
    throw createAbortError();
  }

  let settled = false;
  const cancel = () => {
    if (!settled) {
      void ipcRenderer.invoke(cancelChannel, requestId);
    }
  };
  signal?.addEventListener("abort", cancel, { once: true });
  const handleDelta = (_event: IpcRendererEvent, deltaRequestId: string, chunk: string) => {
    if (deltaRequestId === requestId) {
      delta?.onDelta(chunk);
    }
  };
  if (delta) {
    ipcRenderer.on(delta.channel, handleDelta);
  }

  try {
    return await ipcRenderer.invoke(channel, { ...input, requestId });
  } catch (error) {
    if (signal?.aborted) {
      throw createAbortError();
    }
    throw error;
  } finally {
    settled = true;
    signal?.removeEventListener("abort", cancel);
    if (delta) {
      ipcRenderer.removeListener(delta.channel, handleDelta);
    }
  }
};

const api: InkforgeApi = {
  setTheme: async (theme: "light" | "dark", manual = false): Promise<void> => {
    ipcRenderer.send("theme:set", theme, manual);
  },
  listProjects: async () => [],
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
  runWritingSessionCommand: (input: WritingSessionCommandInput): Promise<WritingSessionState> =>
    ipcRenderer.invoke("agent:writing:command", input)
};

contextBridge.exposeInMainWorld("inkforge", api);

export type { InkforgeApi } from "./types.js";
