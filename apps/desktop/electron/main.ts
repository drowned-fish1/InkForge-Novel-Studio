import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  CreateChapterInput,
  CreateProjectInput,
  ExportInput,
  AiTaskInput,
  ProviderConfigInput,
  PlanningAiInput,
  PlanningImportSelection,
  PlanningSession,
  PipelineStartInput,
  SaveChapterInput,
  SaveChapterSummaryInput,
  SaveCharacterInput,
  SaveClueInput,
  SaveTermInput,
  SaveTimelineEventInput,
  SaveWorldEntryInput,
  UpdateOutlineInput,
  WritingSessionCommandInput
} from "./types.js";
import { AgentService } from "./services/AgentService.js";
import { AiProviderService } from "./services/AiProviderService.js";
import { ChapterService } from "./services/ChapterService.js";
import { ExportService } from "./services/ExportService.js";
import { FileRepository } from "./services/FileRepository.js";
import { LibraryService } from "./services/LibraryService.js";
import { ProjectService } from "./services/ProjectService.js";
import { PlanningService } from "./services/PlanningService.js";
import { StoryStateService } from "./services/StoryStateService.js";
import { SummaryService } from "./services/SummaryService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const files = new FileRepository();
const projects = new ProjectService(files);
const chapters = new ChapterService(files);
const library = new LibraryService(files);
const exportsService = new ExportService(projects, files);
const aiProvider = new AiProviderService();
const summaries = new SummaryService(files);
const storyState = new StoryStateService(files, projects);
const planning = new PlanningService(files, projects, library, storyState);
const agents = new AgentService();

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
    title: "InkForge Local Novel Studio",
    backgroundColor: resolvedWindowBackground(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
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

  ipcMain.handle("project:create", async (_event, input: CreateProjectInput) => {
    const result = await dialog.showOpenDialog({
      title: "选择小说项目保存位置",
      properties: ["openDirectory", "createDirectory"]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return undefined;
    }
    return projects.createProject(result.filePaths[0], input);
  });

  ipcMain.handle("project:open", async (_event, projectPath?: string) => {
    if (projectPath) {
      const issues = await projects.inspectProject(projectPath);
      if (issues.length) {
        throw new Error(`不是完整的 InkForge 项目文件夹：${issues.join("、")}`);
      }
      return projects.openProject(projectPath);
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
    return projects.openProject(result.filePaths[0]);
  });

  ipcMain.handle("project:reveal", async (_event, projectPath: string) => {
    await shell.openPath(projectPath);
  });

  ipcMain.handle("chapter:read", async (_event, projectPath: string, file: string) => {
    return files.readText(files.assertInsideProject(projectPath, file));
  });

  ipcMain.handle("chapter:save", async (_event, input: SaveChapterInput) => {
    await chapters.saveChapter(input);
  });

  ipcMain.handle("chapter:history:list", async (_event, projectPath: string, file: string) => {
    return chapters.listHistoryVersions(projectPath, file);
  });

  ipcMain.handle("chapter:history:read", async (_event, projectPath: string, file: string, historyId: string) => {
    return chapters.readHistoryVersion(projectPath, file, historyId);
  });

  ipcMain.handle("chapter:history:restore", async (_event, projectPath: string, file: string, historyId: string) => {
    return chapters.restoreHistoryVersion(projectPath, file, historyId);
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

  ipcMain.handle("agent:writing:command", async (_event, input: WritingSessionCommandInput) => {
    return agents.runWritingCommand(input);
  });
};
