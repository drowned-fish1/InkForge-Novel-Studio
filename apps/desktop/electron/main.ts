import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from "electron";
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
import type {
  AgentChangeResolutionInput,
  AgentDataResolutionInput,
  AgentChatInput,
  AgentSessionCommandInput,
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
import { RevisionService } from "./services/RevisionService.js";
import { ScenePlanService } from "./services/ScenePlanService.js";
import { SimulationService } from "./services/SimulationService.js";
import { PlanningService } from "./services/PlanningService.js";
import { StoryReferenceService } from "./services/StoryReferenceService.js";
import { StoryStateService } from "./services/StoryStateService.js";
import { SummaryService } from "./services/SummaryService.js";
import { WorkspaceService } from "./services/WorkspaceService.js";

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
const storyState = new StoryStateService(files, projects);
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
const narrativeBoards = new NarrativeBoardService(files);
const playableExports = new PlayableExportService(projects, files, narrativeBoards);
const simulations = new SimulationService(files, library, aiProvider);

const windowBackgrounds = {
  light: "#f4f2ed",
  dark: "#151816"
} as const;
let hasManualWindowTheme = false;

const resolvedWindowBackground = (): string =>
  nativeTheme.shouldUseDarkColors ? windowBackgrounds.dark : windowBackgrounds.light;

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
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
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
  registerIpc();
  nativeTheme.on("updated", () => {
    if (hasManualWindowTheme) {
      return;
    }
    const theme = nativeTheme.shouldUseDarkColors ? "dark" : "light";
    setWindowBackground(theme);
  });
  await createWindow();

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
  ipcMain.on("theme:set", (_event, theme: "light" | "dark", manual = false) => {
    hasManualWindowTheme = manual;
    setWindowBackground(theme);
  });

  ipcMain.handle("project:list", async () => recentProjects.list());

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
    const project = await projects.openProject(result.filePaths[0]);
    await recentProjects.touch(project);
    return project;
  });

  ipcMain.handle("project:reveal", async (_event, projectPath: string) => {
    await shell.openPath(projectPath);
  });

  ipcMain.handle("chapter:read", async (_event, projectPath: string, file: string) => {
    return files.readText(files.assertInsideProject(projectPath, file));
  });

  ipcMain.handle("chapter:save", async (_event, input: SaveChapterInput) => {
    await chapters.saveChapter(input);
    void workspace
      .ensureAutomaticBackup(input.projectPath)
      .catch((error) => console.error("Automatic backup failed:", error));
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
    return library.saveCharacter(input.projectPath, input.character);
  });

  ipcMain.handle("library:world:list", async (_event, projectPath: string) => {
    return library.listWorldEntries(projectPath);
  });

  ipcMain.handle("library:world:save", async (_event, input: SaveWorldEntryInput) => {
    return library.saveWorldEntry(input.projectPath, input.entry);
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
};
