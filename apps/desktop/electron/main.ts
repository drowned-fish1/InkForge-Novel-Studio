import { app, BrowserWindow, dialog, ipcMain, nativeTheme, session, shell } from "electron";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type {
  AgentExtensionConfig,
  BackupSettings,
  BeatBoard,
  ExportConfig,
  ScenePlan,
  SimulationScenario,
  WritingWorkspace
} from "@inkforge/schemas";
import { ChapterContractSchema } from "@inkforge/schemas";
import type {
  AgentChangeResolutionInput,
  AgentDataResolutionInput,
  AgentChatInput,
  AgentSessionCommandInput,
  AnalysisJobStartInput,
  CorpusImportStartInput,
  CreateBatchRunInput,
  CreateChapterInput,
  CreateProjectInput,
  CreateStoryBranchInput,
  ExportInput,
  AiTaskInput,
  ProviderConfigInput,
  PlanningAiInput,
  PlanningImportSelection,
  PlanningSession,
  PlayableExportInput,
  PipelineStartInput,
  SaveChapterInput,
  SaveChapterSummaryInput,
  SaveStoryBranchInput,
  SaveCharacterInput,
  SaveClueInput,
  SaveConflictInput,
  SaveTermInput,
  StoryEntityRef,
  SaveTimelineEventInput,
  SaveWorldEntryInput,
  SimulationRunInput,
  UpdateOutlineInput,
  WritingSessionCommandInput
} from "./types.js";
import { AgentService } from "./services/AgentService.js";
import { AiProviderService } from "./services/AiProviderService.js";
import { BatchProductionService } from "./services/BatchProductionService.js";
import { BranchService } from "./services/BranchService.js";
import { ChapterService } from "./services/ChapterService.js";
import { ChapterMemoryService } from "./services/ChapterMemoryService.js";
import { ChatAgentService } from "./services/ChatAgentService.js";
import { ExportService } from "./services/ExportService.js";
import { FileRepository } from "./services/FileRepository.js";
import { LibraryService } from "./services/LibraryService.js";
import { NarrativeBoardService } from "./services/NarrativeBoardService.js";
import { PlayableExportService } from "./services/PlayableExportService.js";
import { ProjectService } from "./services/ProjectService.js";
import { RecentProjectService } from "./services/RecentProjectService.js";
import { QualityService } from "./services/QualityService.js";
import { ReleaseService } from "./services/ReleaseService.js";
import { ProjectSearchService } from "./services/ProjectSearchService.js";
import { RevisionService } from "./services/RevisionService.js";
import { ScenePlanService } from "./services/ScenePlanService.js";
import { SimulationService } from "./services/SimulationService.js";
import { PlanningService } from "./services/PlanningService.js";
import { StoryReferenceService } from "./services/StoryReferenceService.js";
import { StoryStateService } from "./services/StoryStateService.js";
import { SummaryService } from "./services/SummaryService.js";
import { WorkspaceService } from "./services/WorkspaceService.js";
import { AnalysisJobService } from "./services/AnalysisJobService.js";
import { CanonStore } from "./services/CanonStore.js";
import { ChunkIndexService } from "./services/ChunkIndexService.js";
import { ContextCompiler } from "./services/ContextCompiler.js";
import { ContinuationOrchestrator } from "./services/ContinuationOrchestrator.js";
import { CorpusAdoptionService } from "./services/CorpusAdoptionService.js";
import { CorpusImportService } from "./services/CorpusImportService.js";
import { HybridRetriever } from "./services/HybridRetriever.js";
import { StoryThreadService } from "./services/StoryThreadService.js";
import { StyleProfileService } from "./services/StyleProfileService.js";
import { UpdateService } from "./services/UpdateService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Keep the original internal profile path stable after changing the display
// name. Chromium's safeStorage encryption context is tied to this profile.
if (typeof app.setPath === "function") {
  app.setPath("userData", path.join(app.getPath("appData"), "@inkforge", "desktop"));
}

if (typeof app.setName === "function") {
  app.setName("InkForge 小说工坊");
}

if (process.platform === "win32" && typeof app.setAppUserModelId === "function") {
  app.setAppUserModelId("studio.inkforge.novel");
}

const files = new FileRepository();
const projects = new ProjectService(files);
const recentProjects = new RecentProjectService(path.join(app.getPath("userData"), "recent-projects.json"), files);
const chapters = new ChapterService(files);
const chapterMemories = new ChapterMemoryService(files);
const library = new LibraryService(files);
const exportsService = new ExportService(projects, files);
const aiProvider = new AiProviderService();
const summaries = new SummaryService(files);
const storyState = new StoryStateService(files, projects, library);
const scenePlans = new ScenePlanService(files);
const chatAgent = new ChatAgentService(files, projects, library, storyState, aiProvider);
const planning = new PlanningService(files, projects, library, storyState);
const agents = new AgentService();
const quality = new QualityService(files, projects, storyState);
const branches = new BranchService(files, projects, chapters);
const batches = new BatchProductionService(files, projects, aiProvider, branches, quality);
const release = new ReleaseService(projects, aiProvider, quality, branches, batches);
const workspace = new WorkspaceService(files);
const storyReferences = new StoryReferenceService(files, projects, library, storyState);
const revisions = new RevisionService(files, projects, workspace, quality, storyState, chatAgent);
const projectSearch = new ProjectSearchService(files, projects, library, storyState);
const narrativeBoards = new NarrativeBoardService(files);
const playableExports = new PlayableExportService(projects, files, narrativeBoards);
const simulations = new SimulationService(files, library, aiProvider);
const corpusImports = new CorpusImportService(files);
const corpusAdoption = new CorpusAdoptionService(files, projects, corpusImports);
const analysisJobs = new AnalysisJobService(files, corpusImports);
const chunkIndex = new ChunkIndexService(files);
const hybridRetriever = new HybridRetriever(chunkIndex);
const canonStore = new CanonStore(files);
const storyThreads = new StoryThreadService(files);
const styleProfiles = new StyleProfileService(files, projects);
const contextCompiler = new ContextCompiler(files, projects, canonStore, storyThreads, hybridRetriever);
const continuationRuns = new ContinuationOrchestrator({
  files,
  projects,
  provider: aiProvider,
  branches,
  compiler: contextCompiler,
  styles: styleProfiles
});
const updates = new UpdateService();

const windowBackgrounds = {
  light: "#f4f2ed",
  dark: "#151816"
} as const;
let hasManualWindowTheme = false;

const resolvedWindowBackground = (): string =>
  nativeTheme.shouldUseDarkColors ? windowBackgrounds.dark : windowBackgrounds.light;

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown, label: string): UnknownRecord => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as UnknownRecord;
};

const requiredString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
};

const optionalString = (value: unknown, label: string): string | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  return requiredString(value, label);
};

const optionalNumber = (value: unknown, label: string): number | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return value;
};

const optionalBoolean = (value: unknown, label: string): boolean | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean.`);
  return value;
};

const validateCorpusImportInput = (value: unknown): CorpusImportStartInput => {
  const input = asRecord(value, "Corpus import input");
  const importId = optionalString(input.importId, "importId");
  const sourcePath = optionalString(input.sourcePath, "sourcePath");
  if (!sourcePath && !importId) throw new Error("sourcePath or importId is required.");
  const encoding = input.encoding;
  if (encoding !== undefined && encoding !== "utf8" && encoding !== "gb18030") {
    throw new Error("encoding must be utf8 or gb18030.");
  }
  return {
    projectPath: requiredString(input.projectPath, "projectPath"),
    sourcePath: sourcePath ?? "",
    importId,
    encoding,
    headingPattern: optionalString(input.headingPattern, "headingPattern")
  };
};

const validateAnalysisJobInput = (value: unknown): AnalysisJobStartInput => {
  const input = asRecord(value, "Analysis job input");
  if (input.chapterIds !== undefined) {
    if (!Array.isArray(input.chapterIds) || input.chapterIds.some((item) => typeof item !== "string" || !item.trim())) {
      throw new Error("chapterIds must be an array of non-empty strings.");
    }
  }
  return {
    projectPath: requiredString(input.projectPath, "projectPath"),
    importId: requiredString(input.importId, "importId"),
    jobId: optionalString(input.jobId, "jobId"),
    chapterIds: input.chapterIds as string[] | undefined,
    force: optionalBoolean(input.force, "force")
  };
};

const validateAdoptCorpusInput = (value: unknown) => {
  const input = asRecord(value, "Corpus adoption input");
  const volumeSize = optionalNumber(input.volumeSize, "volumeSize");
  if (volumeSize !== undefined && (!Number.isInteger(volumeSize) || volumeSize < 1)) {
    throw new Error("volumeSize must be a positive integer.");
  }
  return {
    projectPath: requiredString(input.projectPath, "projectPath"),
    importId: requiredString(input.importId, "importId"),
    volumeSize,
    includeDuplicates: optionalBoolean(input.includeDuplicates, "includeDuplicates"),
    volumeTitlePrefix: optionalString(input.volumeTitlePrefix, "volumeTitlePrefix")
  };
};

const validateProjectPathAndId = (projectPath: unknown, id: unknown, idLabel: string): [string, string] => [
  requiredString(projectPath, "projectPath"),
  requiredString(id, idLabel)
];

const validateStatus = (value: unknown, allowed: readonly string[], label: string): string => {
  const status = requiredString(value, label);
  if (!allowed.includes(status)) throw new Error(`${label} is invalid.`);
  return status;
};

const setWindowBackground = (theme: keyof typeof windowBackgrounds): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.setBackgroundColor(windowBackgrounds[theme]);
  }
};

const createWindow = async (): Promise<void> => {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 720,
    title: "InkForge 小说工坊",
    icon: path.join(__dirname, "../build/icon.png"),
    backgroundColor: resolvedWindowBackground(),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  window.webContents.setWindowOpenHandler?.(({ url }) => {
    if (/^https?:\/\//iu.test(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  window.webContents.on?.("will-navigate", (event, url) => {
    const productionEntry = pathToFileURL(path.join(__dirname, "../dist/index.html")).href;
    const allowed = devServerUrl
      ? new URL(url).origin === new URL(devServerUrl).origin
      : url === productionEntry || url.startsWith(`${productionEntry}#`);
    if (!allowed) {
      event.preventDefault();
      if (/^https?:\/\//iu.test(url)) {
        void shell.openExternal(url);
      }
    }
  });
  if (devServerUrl) {
    await window.loadURL(devServerUrl);
    window.webContents.openDevTools({ mode: "detach" });
    return;
  }

  await window.loadFile(path.join(__dirname, "../dist/index.html"));
};

app.whenReady().then(async () => {
  // The renderer never needs runtime permissions (camera, geolocation, …).
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  registerIpc();
  nativeTheme.on("updated", () => {
    if (hasManualWindowTheme) {
      return;
    }
    const theme = nativeTheme.shouldUseDarkColors ? "dark" : "light";
    setWindowBackground(theme);
  });
  await createWindow();
  void updates.configure().then((status) => {
    if (status.configured) void updates.check();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

const registerIpc = (): void => {
  ipcMain.on("theme:set", (_event, theme: unknown, manual: unknown = false) => {
    if (theme !== "light" && theme !== "dark") {
      return;
    }
    hasManualWindowTheme = manual === true;
    setWindowBackground(theme);
  });

  ipcMain.handle("project:list", async () => recentProjects.list());
  ipcMain.handle("updates:status", () => updates.status());
  ipcMain.handle("updates:check", () => updates.check());
  ipcMain.handle("updates:download", () => updates.download());
  ipcMain.handle("updates:install", () => updates.install());

  ipcMain.handle("project:create", async (_event, input: CreateProjectInput) => {
    const result = await dialog.showOpenDialog({
      title: "选择小说项目保存位置",
      properties: ["openDirectory", "createDirectory"]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return undefined;
    }
    const project = await projects.createProject(result.filePaths[0], input);
    await recentProjects.touch(project);
    return project;
  });

  ipcMain.handle("project:open", async (_event, projectPath?: string) => {
    if (projectPath) {
      const issues = await projects.inspectProject(projectPath);
      if (issues.length) {
        throw new Error(`不是完整的 InkForge 项目文件夹：${issues.join("、")}`);
      }
      await storyReferences
        .migrateLegacyReferences(projectPath)
        .catch((error) => console.error("Stable-ID reference migration skipped:", error));
      const project = await projects.openProject(projectPath);
      await recentProjects.touch(project);
      return project;
    }
    const result = await dialog.showOpenDialog({
      title: "打开 / 导入 InkForge 小说项目文件夹",
      properties: ["openDirectory"]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return undefined;
    }
    const issues = await projects.inspectProject(result.filePaths[0]);
    if (issues.length) {
      throw new Error(`不是完整的 InkForge 项目文件夹：${issues.join("、")}`);
    }
    await storyReferences
      .migrateLegacyReferences(result.filePaths[0])
      .catch((error) => console.error("Stable-ID reference migration skipped:", error));
    const project = await projects.openProject(result.filePaths[0]);
    await recentProjects.touch(project);
    return project;
  });

  ipcMain.handle("project:reveal", async (_event, projectPath: string) => {
    // Only reveal folders the app actually knows as projects; a compromised
    // renderer must not be able to launch arbitrary paths via shell.openPath.
    const known = await recentProjects.list();
    const resolved = path.resolve(String(projectPath ?? ""));
    const allowed = known.some((item) => path.resolve(item.projectPath) === resolved);
    if (!allowed) {
      throw new Error("只允许打开最近项目列表中的项目文件夹。");
    }
    await shell.openPath(resolved);
  });

  ipcMain.handle("chapter:read", async (_event, projectPath: string, file: string) => {
    return files.readText(files.assertInsideProject(projectPath, file));
  });

  ipcMain.handle("chapter:save", async (_event, input: SaveChapterInput) => {
    await chapters.saveChapter(input);
    try {
      const project = await projects.openProject(input.projectPath);
      const entry = project.outline.volumes
        .flatMap((volume) => volume.chapters.map((chapter) => ({ volume, chapter })))
        .find(({ chapter }) => chapter.file === input.file);
      if (entry) {
        await chunkIndex.indexChapter(input.projectPath, {
          chapterId: entry.chapter.id,
          title: entry.chapter.title,
          content: input.content,
          volumeId: entry.volume.id,
          volumeTitle: entry.volume.title,
          chapterNumber: entry.chapter.number
        });
      }
    } catch (error) {
      const project = await projects.openProject(input.projectPath).catch(() => undefined);
      const chapterId = project?.outline.volumes
        .flatMap((volume) => volume.chapters)
        .find((chapter) => chapter.file === input.file)?.id;
      if (chapterId) await chunkIndex.removeChapter(input.projectPath, chapterId).catch(() => undefined);
      console.error("Continuation index update failed; stale chapter entry was removed:", error);
    }
    if (process.env.INKFORGE_DISABLE_AUTOMATIC_BACKUP !== "1") {
      void workspace
        .ensureAutomaticBackup(input.projectPath)
        .catch((error) => console.error("Automatic backup failed:", error));
    }
  });

  ipcMain.handle("chapter:history:list", async (_event, projectPath: string, file: string) => {
    return chapters.listHistoryVersions(projectPath, file);
  });

  ipcMain.handle("chapter:history:read", async (_event, projectPath: string, file: string, historyId: string) => {
    return chapters.readHistoryVersion(projectPath, file, historyId);
  });

  ipcMain.handle("chapter:history:restore", async (_event, projectPath: string, file: string, historyId: string) => {
    const content = await chapters.restoreHistoryVersion(projectPath, file, historyId);
    const project = await projects.openProject(projectPath);
    const chapter = project.outline.volumes.flatMap((volume) => volume.chapters).find((item) => item.file === file);
    if (chapter) {
      await chapterMemories.delete(projectPath, chapter.id);
    }
    return content;
  });

  ipcMain.handle("chapter:create", async (_event, input: CreateChapterInput) => {
    return projects.createChapter(input);
  });

  ipcMain.handle("outline:update", async (_event, input: UpdateOutlineInput) => {
    return projects.updateOutline(input);
  });

  ipcMain.handle("export:manuscript", async (_event, input: ExportInput) => {
    return exportsService.exportManuscript(input);
  });

  ipcMain.handle("export:config:load", async (_event, projectPath: string) =>
    exportsService.loadExportConfig(projectPath)
  );

  ipcMain.handle("export:config:save", async (_event, projectPath: string, config: ExportConfig) =>
    exportsService.saveExportConfig(projectPath, config)
  );

  ipcMain.handle("export:preflight", async (_event, projectPath: string) => exportsService.preflight(projectPath));

  ipcMain.handle("export:choose-cover", async () => exportsService.chooseCoverImage());

  ipcMain.handle("backup:list", async (_event, projectPath: string) => workspace.listBackups(projectPath));
  ipcMain.handle("backup:inspect", async (_event, projectPath: string) => workspace.inspectBackups(projectPath));
  ipcMain.handle("backup:create", async (_event, projectPath: string, label?: string) =>
    workspace.createBackup(projectPath, "manual", label)
  );
  ipcMain.handle("backup:restore", async (_event, projectPath: string, snapshotId: string) => {
    await workspace.restoreBackup(projectPath, snapshotId);
    return projects.openProject(projectPath);
  });
  ipcMain.handle("backup:delete", async (_event, projectPath: string, snapshotId: string) =>
    workspace.deleteBackup(projectPath, snapshotId)
  );
  ipcMain.handle("backup:verify", async (_event, projectPath: string, snapshotId: string) =>
    workspace.verifyBackup(projectPath, snapshotId)
  );
  ipcMain.handle("backup:diff", async (_event, projectPath: string, snapshotId: string) =>
    workspace.diffBackup(projectPath, snapshotId)
  );
  ipcMain.handle("backup:read-file", async (_event, projectPath: string, snapshotId: string, file: string) =>
    workspace.readBackupFile(projectPath, snapshotId, file)
  );
  ipcMain.handle("backup:settings:load", async (_event, projectPath: string) =>
    workspace.loadBackupSettings(projectPath)
  );
  ipcMain.handle("backup:settings:save", async (_event, projectPath: string, settings: BackupSettings) =>
    workspace.saveBackupSettings(projectPath, settings)
  );
  ipcMain.handle("backup:choose-directory", async () => {
    const result = await dialog.showOpenDialog({
      title: "选择备份保存目录",
      properties: ["openDirectory", "createDirectory"]
    });
    return result.canceled || !result.filePaths.length ? undefined : result.filePaths[0];
  });
  ipcMain.handle("project:inspect", async (_event, projectPath: string) => projects.inspectProject(projectPath));
  ipcMain.handle("project:choose-folder", async () => {
    const result = await dialog.showOpenDialog({
      title: "选择 InkForge 项目文件夹",
      properties: ["openDirectory"]
    });
    return result.canceled || !result.filePaths.length ? undefined : result.filePaths[0];
  });
  ipcMain.handle("continuation:choose-source", async () => {
    const result = await dialog.showOpenDialog({
      title: "选择长篇小说源文件或目录",
      properties: ["openFile", "openDirectory"]
    });
    return result.canceled || !result.filePaths.length ? undefined : result.filePaths[0];
  });
  ipcMain.handle("chapter:history:overview", async (_event, projectPath: string, files: string[]) =>
    chapters.listHistoryOverview(projectPath, Array.isArray(files) ? files : [])
  );
  ipcMain.handle("writing-workspace:load", async (_event, projectPath: string) =>
    workspace.loadWritingWorkspace(projectPath)
  );
  ipcMain.handle("writing-workspace:save", async (_event, projectPath: string, state: WritingWorkspace) =>
    workspace.saveWritingWorkspace(projectPath, state)
  );
  ipcMain.handle("agent-extensions:load", async (_event, projectPath: string) =>
    workspace.loadAgentExtensions(projectPath)
  );
  ipcMain.handle("agent-extensions:save", async (_event, projectPath: string, config: AgentExtensionConfig) =>
    workspace.saveAgentExtensions(projectPath, config)
  );

  ipcMain.handle("library:characters:list", async (_event, projectPath: string) => {
    return library.listCharacters(projectPath);
  });

  ipcMain.handle("library:characters:save", async (_event, input: SaveCharacterInput) => {
    // Rename-aware save: propagates a changed name to every reference.
    return storyReferences.saveCharacterWithRenameSync(input.projectPath, input.character);
  });

  ipcMain.handle("library:world:list", async (_event, projectPath: string) => {
    return library.listWorldEntries(projectPath);
  });

  ipcMain.handle("library:world:save", async (_event, input: SaveWorldEntryInput) => {
    // Rename-aware save: propagates a changed title to every reference.
    return storyReferences.saveWorldEntryWithRenameSync(input.projectPath, input.entry);
  });

  ipcMain.handle("provider:status", () => aiProvider.getStatus());

  ipcMain.handle("provider:save", async (_event, input: ProviderConfigInput) => {
    return aiProvider.saveProvider(input);
  });

  ipcMain.handle("ai:run-task", async (event, input: AiTaskInput) => {
    return aiProvider.runTask(
      input,
      input.requestId ? (chunk) => event.sender.send("ai:task-delta", input.requestId, chunk) : undefined
    );
  });

  ipcMain.handle("ai:cancel", (_event, requestId: string) => {
    aiProvider.cancelTask(requestId);
  });

  ipcMain.handle("summary:save", async (_event, input: SaveChapterSummaryInput) => {
    return summaries.saveChapterSummary(input);
  });

  ipcMain.handle("summary:list", async (_event, projectPath: string) => {
    return summaries.listSummaries(projectPath);
  });

  ipcMain.handle("story:timeline:list", async (_event, projectPath: string) => {
    return storyState.listTimeline(projectPath);
  });

  ipcMain.handle("story:timeline:save", async (_event, input: SaveTimelineEventInput) => {
    return storyState.saveTimelineEvent(input.projectPath, input.event);
  });

  ipcMain.handle("story:clues:list", async (_event, projectPath: string) => {
    return storyState.listClues(projectPath);
  });

  ipcMain.handle("story:clues:save", async (_event, input: SaveClueInput) => {
    return storyState.saveClue(input.projectPath, input.clue);
  });

  ipcMain.handle("story:terms:list", async (_event, projectPath: string) => {
    return storyState.listTerms(projectPath);
  });

  ipcMain.handle("story:terms:save", async (_event, input: SaveTermInput) => {
    return storyState.saveTerm(input.projectPath, input.term);
  });

  ipcMain.handle("story:conflicts:list", async (_event, projectPath: string) => {
    return storyState.listConflicts(projectPath);
  });

  ipcMain.handle("story:conflicts:save", async (_event, input: SaveConflictInput) => {
    return storyState.saveConflict(input.projectPath, input.conflict);
  });

  ipcMain.handle("story:entity:references", async (_event, projectPath: string, target: StoryEntityRef) => {
    return storyReferences.findReferences(projectPath, target);
  });

  ipcMain.handle("project:search", async (_event, projectPath: string, query: string) =>
    projectSearch.search(projectPath, String(query ?? ""))
  );

  ipcMain.handle("revision:overview", async (_event, projectPath: string) => revisions.overview(projectPath));

  ipcMain.handle(
    "revision:disposition:set",
    async (
      _event,
      projectPath: string,
      key: string,
      status: "open" | "accepted" | "ignored" | "deferred",
      note?: string
    ) => revisions.setDisposition(projectPath, key, status, note)
  );

  ipcMain.handle(
    "story:entity:delete",
    async (
      _event,
      projectPath: string,
      target: StoryEntityRef,
      mode: "force" | "unlink" | "replace",
      replacement?: string
    ) => {
      await storyReferences.deleteEntity(projectPath, target, mode, replacement);
    }
  );

  ipcMain.handle("story:inspect", async (_event, projectPath: string) => {
    return storyState.inspect(projectPath);
  });

  ipcMain.handle("planning:list", async (_event, projectPath: string) => {
    return planning.listSessions(projectPath);
  });

  ipcMain.handle("planning:save", async (_event, projectPath: string, session: PlanningSession) => {
    return planning.saveSession(projectPath, session);
  });

  ipcMain.handle("planning:run-ai", async (_event, input: PlanningAiInput) => {
    return planning.runAi(input);
  });

  ipcMain.handle("planning:cancel", (_event, requestId: string) => {
    planning.cancelRun(requestId);
  });

  ipcMain.handle(
    "planning:import",
    async (_event, projectPath: string, sessionId: string, selection: PlanningImportSelection) => {
      return planning.importPackage(projectPath, sessionId, selection);
    }
  );

  ipcMain.handle("planning:restore-snapshot", async (_event, projectPath: string, snapshotId: string) => {
    return planning.restoreSnapshot(projectPath, snapshotId);
  });

  ipcMain.handle("agent:pipeline:list", () => agents.listPipelinePresets());

  ipcMain.handle("agent:pipeline:start", async (_event, input: PipelineStartInput) => {
    return agents.startPipeline(input);
  });

  ipcMain.handle("agent:pipeline:confirm", async () => {
    return agents.confirmPipelineStep();
  });

  ipcMain.handle("agent:pipeline:pause", () => agents.pausePipeline());

  ipcMain.handle("agent:pipeline:cancel", () => agents.cancelPipeline());

  ipcMain.handle("agent:pipeline:skip", () => agents.skipPipelineStep());

  ipcMain.handle("agent:pipeline:retry", async () => agents.retryPipelineStep());

  ipcMain.handle("agent:writing:command", async (_event, input: WritingSessionCommandInput) => {
    return agents.runWritingCommand(input);
  });

  ipcMain.handle("agent:chat:load", async (_event, projectPath: string, chapterId: string) => {
    return chatAgent.load(projectPath, chapterId);
  });

  ipcMain.handle("agent:chat:run", async (event, input: AgentChatInput) => {
    return chatAgent.chat(
      input,
      input.requestId
        ? (agentEvent) => {
            if (!event.sender.isDestroyed()) {
              event.sender.send("agent:chat:event", input.requestId, agentEvent);
            }
          }
        : undefined
    );
  });

  ipcMain.handle("agent:chat:cancel", (_event, requestId: string) => {
    chatAgent.cancel(requestId);
  });

  ipcMain.handle(
    "agent:chat:estimate",
    async (_event, input: Pick<AgentChatInput, "projectPath" | "chapterId" | "message" | "context" | "limits">) =>
      chatAgent.estimateRun(input)
  );

  ipcMain.handle("agent:chat:approve-tool", (_event, requestId: string, callId: string, approved: boolean) => {
    chatAgent.approveTool(requestId, callId, approved);
  });

  ipcMain.handle("agent:chat:traces", async (_event, projectPath: string, chapterId: string) => {
    return chatAgent.listTraces(projectPath, chapterId);
  });

  ipcMain.handle("agent:chat:resolve-change", async (_event, input: AgentChangeResolutionInput) => {
    return chatAgent.resolveChange(input);
  });

  ipcMain.handle("agent:chat:resolve-data", async (_event, input: AgentDataResolutionInput) => {
    return chatAgent.resolveDataChange(input);
  });

  ipcMain.handle("agent:chat:session", async (_event, input: AgentSessionCommandInput) => {
    return chatAgent.manageSession(input);
  });

  ipcMain.handle("agent:scenes:list", async (_event, projectPath: string, chapterId: string) => {
    return scenePlans.list(projectPath, chapterId);
  });

  ipcMain.handle("agent:scenes:save", async (_event, projectPath: string, chapterId: string, scenes: ScenePlan[]) => {
    return scenePlans.save(projectPath, chapterId, scenes);
  });

  ipcMain.handle("quality:evaluate", async (_event, projectPath: string, chapterId: string) => {
    return quality.evaluateChapter(projectPath, chapterId);
  });

  ipcMain.handle("quality:evaluate-all", async (_event, projectPath: string) => {
    return quality.evaluateAll(projectPath);
  });

  ipcMain.handle("quality:list", async (_event, projectPath: string, chapterId: string) => {
    return quality.listReports(projectPath, chapterId);
  });

  ipcMain.handle("quality:baseline", async (_event, projectPath: string, chapterId: string, reportId: string) => {
    return quality.setBaseline(projectPath, reportId, chapterId);
  });

  ipcMain.handle("branch:list", async (_event, projectPath: string, chapterId?: string) => {
    return branches.list(projectPath, chapterId);
  });

  ipcMain.handle("branch:create", async (_event, input: CreateStoryBranchInput) => {
    return branches.create(input);
  });

  ipcMain.handle("branch:save", async (_event, input: SaveStoryBranchInput) => {
    return branches.save(input);
  });

  ipcMain.handle("branch:compare", async (_event, projectPath: string, branchId: string) => {
    return branches.compare(projectPath, branchId);
  });

  ipcMain.handle("branch:apply", async (_event, projectPath: string, branchId: string) => {
    return branches.apply(projectPath, branchId);
  });

  ipcMain.handle("branch:archive", async (_event, projectPath: string, branchId: string) => {
    return branches.archive(projectPath, branchId);
  });

  ipcMain.handle("batch:list", async (_event, projectPath: string) => {
    return batches.list(projectPath);
  });

  ipcMain.handle("batch:create", async (_event, input: CreateBatchRunInput) => {
    return batches.create(input);
  });

  ipcMain.handle("batch:resume", async (_event, projectPath: string, runId: string) => {
    return batches.resume(projectPath, runId);
  });

  ipcMain.handle("batch:cancel", async (_event, projectPath: string, runId: string) => {
    return batches.cancel(projectPath, runId);
  });

  ipcMain.handle("narrative:board:load", async (_event, projectPath: string) => {
    return narrativeBoards.load(projectPath);
  });

  ipcMain.handle("narrative:board:save", async (_event, projectPath: string, board: BeatBoard) => {
    return narrativeBoards.save(projectPath, board);
  });

  ipcMain.handle("narrative:export", async (_event, input: PlayableExportInput) => {
    return playableExports.exportPlayable(input);
  });

  ipcMain.handle("simulation:list", async (_event, projectPath: string) => {
    return simulations.list(projectPath);
  });

  ipcMain.handle("simulation:save", async (_event, projectPath: string, scenario: SimulationScenario) => {
    return simulations.saveScenario(projectPath, scenario);
  });

  ipcMain.handle("simulation:run", async (event, input: SimulationRunInput) => {
    return simulations.run(
      input,
      input.requestId
        ? (simulationEvent) => {
            if (!event.sender.isDestroyed()) {
              event.sender.send("simulation:event", input.requestId, simulationEvent);
            }
          }
        : undefined
    );
  });

  ipcMain.handle("simulation:cancel", (_event, requestId: string) => {
    simulations.cancel(requestId);
  });

  ipcMain.handle("provider:presets", () => aiProvider.listPresets());
  ipcMain.handle("provider:probe", () => aiProvider.probeProvider());
  ipcMain.handle("release:readiness", async (_event, projectPath: string) => release.inspect(projectPath));

  // Long-novel continuation IPC. Requests are validated at the boundary
  // because preload input may be supplied by an untrusted renderer.
  ipcMain.handle("continuation:import:start", async (event, rawInput: unknown) => {
    const input = validateCorpusImportInput(rawInput);
    return corpusImports.start({
      ...input,
      onProgress: (progress) => {
        if (!event.sender.isDestroyed()) event.sender.send("continuation:import:progress", progress.importId, progress);
      }
    });
  });
  ipcMain.handle("continuation:import:list", async (_event, projectPath: unknown) =>
    corpusImports.list(requiredString(projectPath, "projectPath"))
  );
  ipcMain.handle("continuation:import:pause", async (_event, projectPath: unknown, importId: unknown) => {
    const [project, id] = validateProjectPathAndId(projectPath, importId, "importId");
    return corpusImports.pause(project, id);
  });
  ipcMain.handle("continuation:import:resume", async (event, projectPath: unknown, importId: unknown) => {
    const [project, id] = validateProjectPathAndId(projectPath, importId, "importId");
    return corpusImports.resume(project, id, (progress) => {
      if (!event.sender.isDestroyed()) event.sender.send("continuation:import:progress", progress.importId, progress);
    });
  });
  ipcMain.handle("continuation:import:cancel", async (_event, projectPath: unknown, importId: unknown) => {
    const [project, id] = validateProjectPathAndId(projectPath, importId, "importId");
    return corpusImports.cancel(project, id);
  });
  ipcMain.handle("continuation:adopt", async (_event, rawInput: unknown) =>
    corpusAdoption.adopt(validateAdoptCorpusInput(rawInput))
  );

  ipcMain.handle("continuation:analysis:start", async (event, rawInput: unknown) => {
    const input = validateAnalysisJobInput(rawInput);
    return analysisJobs.start({
      ...input,
      onProgress: (progress) => {
        if (!event.sender.isDestroyed()) event.sender.send("continuation:analysis:progress", progress.jobId, progress);
      }
    });
  });
  ipcMain.handle("continuation:analysis:list", async (_event, projectPath: unknown) =>
    analysisJobs.list(requiredString(projectPath, "projectPath"))
  );
  ipcMain.handle("continuation:analysis:pause", async (_event, projectPath: unknown, jobId: unknown) => {
    const [project, id] = validateProjectPathAndId(projectPath, jobId, "jobId");
    return analysisJobs.pause(project, id);
  });
  ipcMain.handle("continuation:analysis:resume", async (event, projectPath: unknown, jobId: unknown) => {
    const [project, id] = validateProjectPathAndId(projectPath, jobId, "jobId");
    return analysisJobs.resume(project, id, (progress) => {
      if (!event.sender.isDestroyed()) event.sender.send("continuation:analysis:progress", progress.jobId, progress);
    });
  });
  ipcMain.handle("continuation:analysis:cancel", async (_event, projectPath: unknown, jobId: unknown) => {
    const [project, id] = validateProjectPathAndId(projectPath, jobId, "jobId");
    return analysisJobs.cancel(project, id);
  });

  ipcMain.handle("continuation:index:chapter", async (_event, projectPath: unknown, rawInput: unknown) => {
    const project = requiredString(projectPath, "projectPath");
    const input = asRecord(rawInput, "Index chapter input");
    requiredString(input.chapterId, "chapterId");
    if (input.title !== undefined) requiredString(input.title, "title");
    if (input.content !== undefined && typeof input.content !== "string") throw new Error("content must be a string.");
    if (input.text !== undefined && typeof input.text !== "string") throw new Error("text must be a string.");
    return chunkIndex.indexChapter(project, input as never);
  });
  ipcMain.handle("continuation:index:project", async (_event, rawInput: unknown) => {
    if (typeof rawInput === "string") {
      const projectPath = requiredString(rawInput, "projectPath");
      const project = await projects.openProject(projectPath);
      const chapters = [];
      for (const volume of project.outline.volumes) {
        for (const chapter of volume.chapters) {
          const content = await files.readText(files.assertInsideProject(projectPath, chapter.file)).catch(() => "");
          chapters.push({
            chapterId: chapter.id,
            title: chapter.title,
            content,
            volumeId: volume.id,
            volumeTitle: volume.title,
            chapterNumber: chapter.number
          });
        }
      }
      return chunkIndex.indexChapters(projectPath, chapters);
    }
    const input = asRecord(rawInput, "Index project input");
    const projectPath = requiredString(input.projectPath, "projectPath");
    if (!Array.isArray(input.chapters)) throw new Error("chapters must be an array.");
    for (const chapter of input.chapters) {
      const item = asRecord(chapter, "chapter");
      requiredString(item.chapterId, "chapterId");
      if (item.title !== undefined) requiredString(item.title, "title");
    }
    return chunkIndex.indexChapters(projectPath, input.chapters as never);
  });
  ipcMain.handle("continuation:index:stats", async (_event, projectPath: unknown) => {
    const stats = await chunkIndex.getStats(requiredString(projectPath, "projectPath"));
    return { ...stats, chapterCount: stats.chapters, chunkCount: stats.chunks };
  });
  ipcMain.handle(
    "continuation:index:search",
    async (_event, projectPath: unknown, query: unknown, options?: unknown) => {
      const project = requiredString(projectPath, "projectPath");
      if (typeof query !== "string") throw new Error("query must be a string.");
      if (options !== undefined) asRecord(options, "search options");
      return hybridRetriever.search(project, query, (options ?? {}) as never);
    }
  );

  ipcMain.handle("continuation:canon:list", async (_event, projectPath: unknown, filter?: unknown) => {
    const project = requiredString(projectPath, "projectPath");
    if (filter !== undefined) asRecord(filter, "canon filter");
    return canonStore.listFacts(project, (filter ?? {}) as never);
  });
  ipcMain.handle("continuation:canon:save", async (_event, rawInput: unknown) => {
    const input = asRecord(rawInput, "canon fact input");
    const projectPath = requiredString(input.projectPath, "projectPath");
    asRecord(input.fact, "fact");
    return canonStore.saveFact(projectPath, input.fact as never);
  });
  ipcMain.handle(
    "continuation:canon:status",
    async (_event, projectPath: unknown, factId: unknown, status: unknown) => {
      const [project, id] = validateProjectPathAndId(projectPath, factId, "factId");
      const parsed = validateStatus(
        status,
        ["candidate", "confirmed", "author_locked", "conflicted", "rejected"],
        "status"
      );
      return canonStore.setFactStatus(project, id, parsed as never);
    }
  );

  ipcMain.handle("continuation:threads:list", async (_event, projectPath: unknown, filter?: unknown) => {
    const project = requiredString(projectPath, "projectPath");
    if (filter !== undefined) asRecord(filter, "thread filter");
    return storyThreads.listThreads(project, (filter ?? {}) as never);
  });
  ipcMain.handle("continuation:threads:save", async (_event, rawInput: unknown) => {
    const input = asRecord(rawInput, "story thread input");
    const projectPath = requiredString(input.projectPath, "projectPath");
    asRecord(input.thread, "thread");
    return storyThreads.saveThread(projectPath, input.thread as never);
  });
  ipcMain.handle(
    "continuation:threads:status",
    async (_event, projectPath: unknown, threadId: unknown, status: unknown) => {
      const [project, id] = validateProjectPathAndId(projectPath, threadId, "threadId");
      const parsed = validateStatus(
        status,
        ["candidate", "active", "progressing", "due", "resolved", "abandoned"],
        "status"
      );
      return storyThreads.setStatus(project, id, parsed as never);
    }
  );

  ipcMain.handle("continuation:style:analyze", async (_event, projectPath: unknown, options?: unknown) => {
    const project = requiredString(projectPath, "projectPath");
    if (options !== undefined) asRecord(options, "style options");
    return styleProfiles.analyzeProject(project, (options ?? {}) as never);
  });
  ipcMain.handle("continuation:style:load", async (_event, projectPath: unknown) =>
    styleProfiles.load(requiredString(projectPath, "projectPath"))
  );
  ipcMain.handle(
    "continuation:style:evaluate",
    async (_event, projectPath: unknown, text: unknown, tolerance?: unknown) => {
      const project = requiredString(projectPath, "projectPath");
      if (typeof text !== "string") throw new Error("text must be a string.");
      const parsedTolerance = optionalNumber(tolerance, "tolerance");
      return styleProfiles.evaluateText(project, text, parsedTolerance);
    }
  );
  ipcMain.handle("continuation:context:compile", async (_event, rawInput: unknown) => {
    const input = asRecord(rawInput, "context input");
    requiredString(input.projectPath, "projectPath");
    requiredString(input.chapterId, "chapterId");
    asRecord(input.contract, "contract");
    return contextCompiler.compile(input as never);
  });
  ipcMain.handle("continuation:run:list", async (_event, projectPath: unknown, chapterId?: unknown) => {
    const project = requiredString(projectPath, "projectPath");
    const runs = await continuationRuns.list(project);
    if (chapterId === undefined) return runs;
    const chapter = requiredString(chapterId, "chapterId");
    return runs.filter((run) => run.chapterId === chapter);
  });
  ipcMain.handle("continuation:run:start", async (_event, rawInput: unknown) => {
    const input = asRecord(rawInput, "continuation run input");
    const projectPath = requiredString(input.projectPath, "projectPath");
    const chapterId = requiredString(input.chapterId, "chapterId");
    const contract = ChapterContractSchema.parse(input.contract);
    if (contract.chapterId && contract.chapterId !== chapterId) {
      throw new Error("章节契约与续写目标章节不一致。");
    }
    return continuationRuns.start({
      projectPath,
      chapterId,
      contract,
      instruction: optionalString(input.instruction, "instruction"),
      runId: optionalString(input.runId, "runId"),
      requestId: optionalString(input.requestId, "requestId"),
      tokenBudget: optionalNumber(input.tokenBudget, "tokenBudget"),
      retrievalLimit: optionalNumber(input.retrievalLimit, "retrievalLimit"),
      maxOutputTokens: optionalNumber(input.maxOutputTokens, "maxOutputTokens"),
      modelOverride: optionalString(input.modelOverride, "modelOverride"),
      useEditorModel: input.useEditorModel === true,
      branchName: optionalString(input.branchName, "branchName"),
      branchDescription: optionalString(input.branchDescription, "branchDescription")
    });
  });
  ipcMain.handle(
    "continuation:run:retry",
    async (_event, projectPath: unknown, runId: unknown, rawOptions?: unknown) => {
      const [project, id] = validateProjectPathAndId(projectPath, runId, "runId");
      if (rawOptions === undefined) return continuationRuns.retry(project, id);
      const options = asRecord(rawOptions, "continuation retry options");
      return continuationRuns.retry(project, id, {
        instruction: optionalString(options.instruction, "instruction"),
        tokenBudget: optionalNumber(options.tokenBudget, "tokenBudget"),
        retrievalLimit: optionalNumber(options.retrievalLimit, "retrievalLimit"),
        maxOutputTokens: optionalNumber(options.maxOutputTokens, "maxOutputTokens"),
        modelOverride: optionalString(options.modelOverride, "modelOverride"),
        useEditorModel: options.useEditorModel === true,
        branchName: optionalString(options.branchName, "branchName"),
        branchDescription: optionalString(options.branchDescription, "branchDescription"),
        requestId: optionalString(options.requestId, "requestId")
      });
    }
  );
  ipcMain.handle("continuation:run:cancel", async (_event, projectPath: unknown, runId: unknown) => {
    const [project, id] = validateProjectPathAndId(projectPath, runId, "runId");
    return continuationRuns.cancel(project, id);
  });
};
