import {
  CharacterSchema,
  ClueSchema,
  createProjectId,
  defaultProviderConfig,
  inkforgeSchemaVersion,
  OutlineSchema,
  PlanningSessionSchema,
  ProjectMetaSchema,
  PromptTemplateSchema,
  TermSchema,
  TimelineEventSchema,
  WorldEntrySchema,
  type Character,
  type ChapterPlan,
  type Outline,
  type PromptTemplate,
  type ProjectMeta,
  type WorldEntry
} from "@inkforge/schemas";
import type {
  ChapterHistoryEntry,
  CreateChapterInput,
  CreateProjectInput,
  ExportInput,
  ProjectListItem,
  ProjectSummary,
  SaveChapterInput,
  SaveChapterSummaryInput,
  UpdateOutlineInput
} from "@/types/app";
import { createDefaultPromptTemplate, promptTemplateFileName, type PromptTask } from "@inkforge/prompt-engine";
import {
  getProjectRecord,
  readProjectStorage,
  saveProjectRecord,
  toOffsetIso,
  writeProjectStorage,
  type BrowserProjectRecord
} from "@/lib/browserStorage";

const slugPart = (value: string): string =>
  value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 48) || "untitled";

const chapterFile = (volumeNumber: number, chapterNumber: number): string =>
  `chapters/volume-${String(volumeNumber).padStart(3, "0")}/ch-${String(chapterNumber).padStart(4, "0")}.md`;

const fallbackChapterNames = [
  "风起之时",
  "暗流初现",
  "旧事回响",
  "迷雾渐深",
  "变局将至",
  "抉择之刻",
  "临界之夜",
  "新途开启"
];

const suggestChapterTitle = (chapterNumber: number, previous?: Pick<ChapterPlan, "goal" | "hook">): string => {
  const seed = [previous?.hook, previous?.goal]
    .map((value) =>
      (value ?? "")
        .replace(/^第[一二三四五六七八九十百千万\d]+章\s*/u, "")
        .replace(/[“”"'《》【】]/gu, "")
        .split(/[，,。！？!?；;：:\n]/u)[0]
        .trim()
    )
    .find(
      (value) =>
        value.length >= 3 &&
        !/未命名|明确问题推动读者|建立主角、冲突与第一处悬念|介绍主角|补充本章剧情目标/u.test(value)
    );
  const name = seed ? seed.slice(0, 16) : fallbackChapterNames[(chapterNumber - 1) % fallbackChapterNames.length];
  return `第${chapterNumber}章 ${name}`;
};

const removeLegacyBrowserDefaults = (record: BrowserProjectRecord): BrowserProjectRecord => {
  const next = structuredClone(record);
  if (
    next.summary.outline.premise === "边城少年得到父亲留下的黑匣，发现自身血脉与失落星火有关。" ||
    next.summary.outline.premise === "边城少年林烬在父亲失踪后得到黑匣，发现体内藏着失落星火血脉。"
  ) {
    next.summary.outline.premise = "";
  }
  for (const volume of next.summary.outline.volumes) {
    if (volume.goal === "建立世界、主角动机与核心冲突") {
      volume.goal = "";
    }
    for (const chapter of volume.chapters) {
      if (chapter.goal === "介绍主角：林烬，边城少年，寻找失踪父亲" || chapter.goal === "建立主角、冲突与第一处悬念") {
        chapter.goal = "";
      }
      if (chapter.hook === "用一个明确问题推动读者进入下一章") {
        chapter.hook = "";
      }
      if (next.chapterBodies[chapter.file] === `# ${chapter.title}\n\n在这里开始写作。\n`) {
        next.chapterBodies[chapter.file] = "";
      }
    }
  }
  next.characters = next.characters.filter(
    (character) =>
      !(
        character.id === "char_main_protagonist" &&
        character.name === "主角" &&
        !character.profile.age &&
        !character.profile.identity &&
        !character.profile.motivation &&
        !character.profile.personality &&
        !character.currentState.powerLevel &&
        !character.currentState.location &&
        !character.currentState.relationships.length &&
        !character.currentState.secrets.length &&
        !character.voiceNotes
      )
  );
  next.worldEntries = next.worldEntries.filter(
    (entry) => !(entry.id === "initial-world" && entry.title === "初始世界观" && !entry.content.trim())
  );
  return next;
};

const promptTasks: PromptTask[] = [
  "continue",
  "expand",
  "rewrite",
  "dialogue",
  "action",
  "summary",
  "next-goal",
  "pacing",
  "character-state",
  "character-generate",
  "character-names",
  "clue-check",
  "term-check",
  "polish",
  "typo",
  "pre-export"
];

const createDefaultPromptFiles = () =>
  Object.fromEntries(promptTasks.map((task) => [promptTemplateFileName(task), createDefaultPromptTemplate(task)]));

type BrowserDirectoryHandle = {
  kind?: "directory";
  name?: string;
  getDirectoryHandle: (name: string, options?: { create?: boolean }) => Promise<BrowserDirectoryHandle>;
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<BrowserFileHandle>;
  values?: () => AsyncIterable<BrowserFileSystemHandle>;
  queryPermission?: (descriptor?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>;
  requestPermission?: (descriptor?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>;
};

type BrowserFileHandle = {
  kind?: "file";
  name?: string;
  getFile: () => Promise<File>;
  createWritable: () => Promise<{
    write: (data: BlobPart) => Promise<void>;
    close: () => Promise<void>;
  }>;
};

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: { mode?: "read" | "readwrite" }) => Promise<BrowserDirectoryHandle>;
};

type BrowserFileSystemHandle = BrowserDirectoryHandle | BrowserFileHandle;

const projectHandleStoreName = "projectHandles";
const projectHandleDbName = "inkforge-browser-project-handles";
const projectFolderWarning =
  "浏览器预览无法创建项目文件夹，已退回到浏览器本地存储。建议使用桌面版或支持 File System Access 的 Chromium/Edge。";
const projectFolderConflictPrefix = "目标项目文件夹已存在";

const safeFileId = (value: string): string =>
  value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 64) || `item-${Date.now()}`;

const projectFolderHandles = new Map<string, BrowserDirectoryHandle>();

const openHandleDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(projectHandleDbName, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(projectHandleStoreName);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const saveProjectFolderHandle = async (projectPath: string, handle: BrowserDirectoryHandle): Promise<void> => {
  const db = await openHandleDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(projectHandleStoreName, "readwrite");
    transaction.objectStore(projectHandleStoreName).put(handle, projectPath);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
};

const loadProjectFolderHandle = async (projectPath: string): Promise<BrowserDirectoryHandle | undefined> => {
  const cached = projectFolderHandles.get(projectPath);
  if (cached) {
    return cached;
  }
  const db = await openHandleDb();
  const handle = await new Promise<BrowserDirectoryHandle | undefined>((resolve, reject) => {
    const transaction = db.transaction(projectHandleStoreName, "readonly");
    const request = transaction.objectStore(projectHandleStoreName).get(projectPath);
    request.onsuccess = () => resolve(request.result as BrowserDirectoryHandle | undefined);
    request.onerror = () => reject(request.error);
  });
  db.close();
  if (handle) {
    projectFolderHandles.set(projectPath, handle);
  }
  return handle;
};

const writeFile = async (dir: BrowserDirectoryHandle, fileName: string, content: string): Promise<void> => {
  const file = await dir.getFileHandle(fileName, { create: true });
  const writable = await file.createWritable();
  await writable.write(content);
  await writable.close();
};

const writeJson = async (dir: BrowserDirectoryHandle, fileName: string, value: unknown): Promise<void> => {
  await writeFile(dir, fileName, `${JSON.stringify(value, null, 2)}\n`);
};

const readFile = async (dir: BrowserDirectoryHandle, fileName: string): Promise<string> => {
  const handle = await dir.getFileHandle(fileName);
  const file = await handle.getFile();
  return file.text();
};

const readJson = async <T>(dir: BrowserDirectoryHandle, fileName: string): Promise<T> =>
  JSON.parse(await readFile(dir, fileName)) as T;

const readOptionalJson = async <T>(dir: BrowserDirectoryHandle, fileName: string): Promise<T | undefined> => {
  try {
    return await readJson<T>(dir, fileName);
  } catch {
    return undefined;
  }
};

const readOptionalText = async (root: BrowserDirectoryHandle, relativePath: string): Promise<string | undefined> => {
  try {
    const parts = relativePath.split(/[\\/]+/).filter(Boolean);
    const fileName = parts.pop();
    if (!fileName) {
      return undefined;
    }
    let dir = root;
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part);
    }
    return readFile(dir, fileName);
  } catch {
    return undefined;
  }
};

const ensureNestedDir = async (root: BrowserDirectoryHandle, parts: string[]): Promise<BrowserDirectoryHandle> => {
  let dir = root;
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create: true });
  }
  return dir;
};

const writeNestedText = async (root: BrowserDirectoryHandle, relativePath: string, content: string): Promise<void> => {
  const parts = relativePath.split(/[\\/]+/).filter(Boolean);
  const fileName = parts.pop();
  if (!fileName) {
    return;
  }
  const dir = await ensureNestedDir(root, parts);
  await writeFile(dir, fileName, content);
};

const listFiles = async (dir: BrowserDirectoryHandle): Promise<BrowserFileHandle[]> => {
  if (!dir.values) {
    return [];
  }
  const files: BrowserFileHandle[] = [];
  for await (const handle of dir.values()) {
    if (handle.kind === "file") {
      files.push(handle as BrowserFileHandle);
    }
  }
  return files;
};

const readDirectoryJsonItems = async <T>(
  root: BrowserDirectoryHandle,
  directoryName: string,
  predicate: (name: string) => boolean,
  parse: (value: unknown) => T
): Promise<T[]> => {
  try {
    const dir = await root.getDirectoryHandle(directoryName);
    const files = await listFiles(dir);
    const items: T[] = [];
    for (const fileHandle of files.filter((handle) => predicate(handle.name ?? ""))) {
      const file = await fileHandle.getFile();
      items.push(parse(JSON.parse(await file.text())));
    }
    return items;
  } catch {
    return [];
  }
};

const readWorldEntries = async (root: BrowserDirectoryHandle): Promise<WorldEntry[]> => {
  try {
    const dir = await root.getDirectoryHandle("world");
    const files = await listFiles(dir);
    const entries: WorldEntry[] = [];
    for (const fileHandle of files) {
      const name = fileHandle.name ?? "";
      const text = await (await fileHandle.getFile()).text();
      if (name.endsWith(".world.json")) {
        entries.push(WorldEntrySchema.parse(JSON.parse(text)));
      } else if (name.endsWith(".md")) {
        entries.push(
          WorldEntrySchema.parse({
            id: name.replace(/\.md$/iu, ""),
            title: name.replace(/\.md$/iu, ""),
            type: name.includes("power") ? "power-system" : "note",
            content: text
          })
        );
      }
    }
    return entries;
  } catch {
    return [];
  }
};

const readPromptFiles = async (root: BrowserDirectoryHandle): Promise<Record<string, PromptTemplate>> => {
  try {
    const dir = await root.getDirectoryHandle("prompts");
    const files = await listFiles(dir);
    const prompts: Record<string, PromptTemplate> = {};
    for (const fileHandle of files.filter((handle) => (handle.name ?? "").endsWith(".json"))) {
      const file = await fileHandle.getFile();
      prompts[fileHandle.name ?? file.name] = PromptTemplateSchema.parse(JSON.parse(await file.text()));
    }
    return prompts;
  } catch {
    return {};
  }
};

const readSummaries = async (root: BrowserDirectoryHandle): Promise<Record<string, unknown>> => {
  try {
    const dir = await root.getDirectoryHandle("summaries");
    const files = await listFiles(dir);
    const summaries: Record<string, unknown> = {};
    for (const fileHandle of files.filter((handle) => (handle.name ?? "").endsWith(".json"))) {
      const file = await fileHandle.getFile();
      const name = fileHandle.name ?? file.name;
      summaries[`summaries/${name}`] = JSON.parse(await file.text());
    }
    return summaries;
  } catch {
    return {};
  }
};

const syncProjectFolder = async (record: BrowserProjectRecord, handle: BrowserDirectoryHandle): Promise<void> => {
  await ensureNestedDir(handle, ["chapters", "volume-001"]);
  await ensureNestedDir(handle, ["characters"]);
  await ensureNestedDir(handle, ["world"]);
  await ensureNestedDir(handle, ["summaries"]);
  await ensureNestedDir(handle, ["prompts"]);
  await ensureNestedDir(handle, ["exports"]);
  const appDir = await ensureNestedDir(handle, [".inkforge"]);

  await writeJson(handle, "project.novel.json", record.summary.meta);
  await writeJson(handle, "outline.json", record.summary.outline);
  await writeJson(handle, "timeline.json", record.timeline);
  await writeJson(handle, "clues.json", record.clues);
  await writeJson(handle, "terms.json", record.terms);
  await writeJson(appDir, "planning-sessions.json", record.planningSessions);
  await writeJson(appDir, "import-snapshots.json", record.importSnapshots);
  await writeJson(appDir, "browser-project-record.json", record);

  for (const [relativePath, content] of Object.entries(record.chapterBodies)) {
    await writeNestedText(handle, relativePath, content);
  }
  const characterDir = await ensureNestedDir(handle, ["characters"]);
  for (const character of record.characters) {
    await writeJson(characterDir, `${safeFileId(character.id)}.json`, character);
  }
  const worldDir = await ensureNestedDir(handle, ["world"]);
  for (const entry of record.worldEntries) {
    await writeJson(worldDir, `${safeFileId(entry.id)}.world.json`, entry);
  }
  const promptDir = await ensureNestedDir(handle, ["prompts"]);
  for (const [fileName, prompt] of Object.entries(record.prompts)) {
    await writeJson(promptDir, safeFileId(fileName), prompt);
  }
};

const createProjectFolder = async (record: BrowserProjectRecord): Promise<void> => {
  const picker = window as DirectoryPickerWindow;
  if (!picker.showDirectoryPicker) {
    console.warn(projectFolderWarning);
    return;
  }
  try {
    const parent = await picker.showDirectoryPicker({ mode: "readwrite" });
    const folderName = slugPart(record.summary.meta.title);
    const handle = await parent.getDirectoryHandle(folderName, { create: true });
    if (handle.values) {
      for await (const _entry of handle.values()) {
        throw new Error(`${projectFolderConflictPrefix}且不为空：${folderName}`);
      }
    } else {
      const hasProjectFile = await handle
        .getFileHandle("project.novel.json")
        .then(() => true)
        .catch((error) => {
          if (error && typeof error === "object" && "name" in error && error.name === "NotFoundError") {
            return false;
          }
          throw error;
        });
      if (hasProjectFile) {
        throw new Error(`${projectFolderConflictPrefix}：${folderName}`);
      }
    }
    projectFolderHandles.set(record.summary.projectPath, handle);
    await saveProjectFolderHandle(record.summary.projectPath, handle);
    await syncProjectFolder(record, handle);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(projectFolderConflictPrefix)) {
      throw error;
    }
    console.warn(projectFolderWarning, error);
  }
};

const ensureReadWritePermission = async (handle: BrowserDirectoryHandle): Promise<boolean> => {
  const descriptor = { mode: "readwrite" as const };
  if ((await handle.queryPermission?.(descriptor)) === "granted") {
    return true;
  }
  return !handle.requestPermission || (await handle.requestPermission(descriptor)) === "granted";
};

const normalizeImportedRecord = (
  record: BrowserProjectRecord,
  _handle: BrowserDirectoryHandle
): BrowserProjectRecord => {
  const projectPath =
    record.summary.projectPath || `browser-project://${Date.now()}-${slugPart(record.summary.meta.title)}`;
  return {
    ...record,
    summary: {
      ...record.summary,
      projectPath,
      meta: ProjectMetaSchema.parse(record.summary.meta),
      outline: OutlineSchema.parse(record.summary.outline)
    },
    chapterBodies: record.chapterBodies ?? {},
    chapterHistory: record.chapterHistory ?? {},
    characters: (record.characters ?? []).map((item) => CharacterSchema.parse(item)),
    worldEntries: (record.worldEntries ?? []).map((item) => WorldEntrySchema.parse(item)),
    timeline: (record.timeline ?? []).map((item) => TimelineEventSchema.parse(item)),
    clues: (record.clues ?? []).map((item) => ClueSchema.parse(item)),
    terms: (record.terms ?? []).map((item) => TermSchema.parse(item)),
    prompts: record.prompts ?? createDefaultPromptFiles(),
    summaries: record.summaries ?? {},
    planningSessions: (record.planningSessions ?? []).map((item) => PlanningSessionSchema.parse(item)),
    importSnapshots: record.importSnapshots ?? {},
    updatedAt: record.updatedAt ?? new Date().toISOString()
  };
};

const reconstructProjectRecord = async (handle: BrowserDirectoryHandle): Promise<BrowserProjectRecord> => {
  const meta = ProjectMetaSchema.parse(await readJson<unknown>(handle, "project.novel.json"));
  const outline = OutlineSchema.parse(await readJson<unknown>(handle, "outline.json"));
  const chapterBodies: Record<string, string> = {};

  for (const chapter of outline.volumes.flatMap((volume) => volume.chapters)) {
    chapterBodies[chapter.file] = (await readOptionalText(handle, chapter.file)) ?? "";
  }

  const appDir = await handle.getDirectoryHandle(".inkforge").catch(() => undefined);
  const planningSessions = appDir
    ? ((await readOptionalJson<unknown[]>(appDir, "planning-sessions.json")) ?? []).map((item) =>
        PlanningSessionSchema.parse(item)
      )
    : [];
  const importSnapshots = appDir
    ? ((await readOptionalJson<Record<string, unknown>>(appDir, "import-snapshots.json")) ?? {})
    : {};

  return {
    summary: {
      projectPath: `browser-project://${Date.now()}-${slugPart(meta.title)}`,
      meta,
      outline
    },
    chapterBodies,
    chapterHistory: {},
    characters: await readDirectoryJsonItems<Character>(
      handle,
      "characters",
      (name) => name.endsWith(".json"),
      (value) => CharacterSchema.parse(value)
    ),
    worldEntries: await readWorldEntries(handle),
    timeline: ((await readOptionalJson<unknown[]>(handle, "timeline.json")) ?? []).map((item) =>
      TimelineEventSchema.parse(item)
    ),
    clues: ((await readOptionalJson<unknown[]>(handle, "clues.json")) ?? []).map((item) => ClueSchema.parse(item)),
    terms: ((await readOptionalJson<unknown[]>(handle, "terms.json")) ?? []).map((item) => TermSchema.parse(item)),
    prompts: { ...createDefaultPromptFiles(), ...(await readPromptFiles(handle)) },
    summaries: await readSummaries(handle),
    planningSessions,
    importSnapshots,
    updatedAt: new Date().toISOString()
  };
};

const readProjectRecordFromFolder = async (handle: BrowserDirectoryHandle): Promise<BrowserProjectRecord> => {
  const appDir = await handle.getDirectoryHandle(".inkforge").catch(() => undefined);
  const exactRecord = appDir
    ? await readOptionalJson<BrowserProjectRecord>(appDir, "browser-project-record.json")
    : undefined;
  return normalizeImportedRecord(exactRecord ?? (await reconstructProjectRecord(handle)), handle);
};

const importProjectFolder = async (): Promise<ProjectSummary | undefined> => {
  const picker = window as DirectoryPickerWindow;
  if (!picker.showDirectoryPicker) {
    throw new Error("当前浏览器不支持选择项目文件夹。请使用桌面版或 Chromium/Edge。");
  }
  const handle = await picker.showDirectoryPicker({ mode: "readwrite" });
  if (!(await ensureReadWritePermission(handle))) {
    throw new Error("需要读写权限才能把项目文件夹作为工作区。");
  }

  const record = await readProjectRecordFromFolder(handle);
  projectFolderHandles.set(record.summary.projectPath, handle);
  await saveProjectFolderHandle(record.summary.projectPath, handle);
  saveProjectRecord(record);
  await syncProjectFolder(record, handle);
  return structuredClone(record.summary);
};

window.__inkforgePersistProjectRecord = (record: BrowserProjectRecord): void => {
  void loadProjectFolderHandle(record.summary.projectPath)
    .then((handle) => (handle ? syncProjectFolder(record, handle) : undefined))
    .catch((error) => console.warn("项目文件夹同步失败，浏览器存储仍已保存。", error));
};

const createProjectRecord = (input: CreateProjectInput): BrowserProjectRecord => {
  const now = toOffsetIso();
  const projectPath = `browser-project://${Date.now()}-${slugPart(input.title)}`;
  const firstChapter: ChapterPlan = {
    id: "ch-0001",
    number: 1,
    title: suggestChapterTitle(1),
    file: chapterFile(1, 1),
    goal: "",
    hook: "",
    status: "drafting",
    targetWords: 3000,
    actualWords: 0,
    archived: false,
    notes: "",
    conflictPoints: "",
    characters: [],
    worldRefs: []
  };
  const meta: ProjectMeta = {
    schemaVersion: inkforgeSchemaVersion,
    projectId: createProjectId(input.title),
    title: input.title,
    author: input.author || "local-user",
    genre: input.genre,
    targetWords: input.targetWords,
    createdAt: now,
    updatedAt: now,
    defaultProviderId: defaultProviderConfig.providerId,
    defaultModel: defaultProviderConfig.model,
    writingPreferences: {
      pov: "第三人称有限视角",
      style: input.style || "",
      chapterWords: 3000
    }
  };
  const outline: Outline = {
    schemaVersion: inkforgeSchemaVersion,
    premise: input.premise,
    mainConflict: "",
    endingDirection: "",
    volumes: [
      {
        id: "vol-001",
        title: "第一卷",
        goal: "",
        targetWords: 90000,
        chapters: [firstChapter]
      }
    ]
  };

  return {
    summary: { projectPath, meta, outline },
    chapterBodies: {
      [firstChapter.file]: ""
    },
    chapterHistory: {},
    characters: [],
    worldEntries: [],
    timeline: [],
    clues: [],
    terms: [],
    prompts: createDefaultPromptFiles(),
    summaries: {},
    planningSessions: [],
    importSnapshots: {},
    updatedAt: new Date().toISOString()
  };
};

const projectList = (): ProjectListItem[] =>
  Object.values(readProjectStorage().projects)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((record) => ({
      projectPath: record.summary.projectPath,
      title: record.summary.meta.title,
      updatedAt: record.updatedAt,
      chapterCount: record.summary.outline.volumes.reduce((count, volume) => count + volume.chapters.length, 0)
    }));

export const browserProjectService = {
  async listProjects(): Promise<ProjectListItem[]> {
    return projectList();
  },
  async createProject(input: CreateProjectInput): Promise<ProjectSummary> {
    const record = createProjectRecord(input);
    await createProjectFolder(record);
    saveProjectRecord(record);
    return structuredClone(record.summary);
  },
  async importProjectFolder(): Promise<ProjectSummary | undefined> {
    return importProjectFolder();
  },
  async openProject(projectPath?: string): Promise<ProjectSummary | undefined> {
    const storage = readProjectStorage();
    const fallbackPath = projectList()[0]?.projectPath;
    const nextPath = projectPath ?? storage.activeProjectPath ?? fallbackPath;
    if (!nextPath || !storage.projects[nextPath]) {
      return undefined;
    }
    storage.projects[nextPath] = removeLegacyBrowserDefaults(storage.projects[nextPath]);
    storage.activeProjectPath = nextPath;
    writeProjectStorage(storage);
    return structuredClone(storage.projects[nextPath].summary);
  },
  async revealProject(): Promise<void> {},
  async readChapter(projectPath: string, file: string): Promise<string> {
    return getProjectRecord(projectPath).chapterBodies[file] ?? "";
  },
  async saveChapter(input: SaveChapterInput): Promise<void> {
    const record = getProjectRecord(input.projectPath);
    const previous = record.chapterBodies[input.file];
    if (previous !== undefined && previous !== input.content) {
      const history = record.chapterHistory ?? {};
      const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 8)}.md`;
      history[input.file] = [
        { id, createdAt: new Date().toISOString(), content: previous },
        ...(history[input.file] ?? [])
      ].slice(0, 50);
      record.chapterHistory = history;
    }
    record.chapterBodies[input.file] = input.content;
    saveProjectRecord(record);
  },
  async listChapterHistory(projectPath: string, file: string): Promise<ChapterHistoryEntry[]> {
    const record = getProjectRecord(projectPath);
    return (record.chapterHistory?.[file] ?? []).map((entry) => ({
      id: entry.id,
      createdAt: entry.createdAt,
      size: new Blob([entry.content]).size
    }));
  },
  async readChapterHistory(projectPath: string, file: string, historyId: string): Promise<string> {
    const record = getProjectRecord(projectPath);
    const entry = record.chapterHistory?.[file]?.find((item) => item.id === historyId);
    if (!entry) {
      throw new Error("Chapter history version not found.");
    }
    return entry.content;
  },
  async restoreChapterHistory(projectPath: string, file: string, historyId: string): Promise<string> {
    const content = await this.readChapterHistory(projectPath, file, historyId);
    await this.saveChapter({ projectPath, file, content });
    return content;
  },
  async createChapter(input: CreateChapterInput): Promise<ProjectSummary> {
    const record = getProjectRecord(input.projectPath);
    const volume =
      record.summary.outline.volumes.find((item) => item.id === input.volumeId) ?? record.summary.outline.volumes[0];
    const maxChapterNumber = Math.max(
      0,
      ...record.summary.outline.volumes.flatMap((item) => item.chapters.map((chapter) => chapter.number))
    );
    const nextNumber = maxChapterNumber + 1;
    const volumeNumber = record.summary.outline.volumes.findIndex((item) => item.id === volume.id) + 1;
    const previousChapter = volume.chapters.at(-1);
    const chapter: ChapterPlan = {
      id: `ch-${String(nextNumber).padStart(4, "0")}`,
      number: nextNumber,
      title: input.title?.trim() || suggestChapterTitle(nextNumber, previousChapter),
      file: chapterFile(volumeNumber, nextNumber),
      goal: "",
      hook: "",
      status: "drafting",
      targetWords: record.summary.meta.writingPreferences.chapterWords,
      actualWords: 0,
      archived: false,
      notes: "",
      conflictPoints: "",
      characters: [],
      worldRefs: []
    };
    volume.chapters.push(chapter);
    record.chapterBodies[chapter.file] = "";
    saveProjectRecord(record);
    return structuredClone(record.summary);
  },
  async updateOutline(input: UpdateOutlineInput): Promise<ProjectSummary> {
    const record = getProjectRecord(input.projectPath);
    record.summary.outline = structuredClone(input.outline);
    for (const chapter of record.summary.outline.volumes.flatMap((volume) => volume.chapters)) {
      record.chapterBodies[chapter.file] ??= "";
    }
    saveProjectRecord(record);
    return structuredClone(record.summary);
  },
  async exportManuscript(input: ExportInput): Promise<string> {
    const extension = input.format === "markdown" ? "md" : input.format;
    return `${input.projectPath}/exports/manuscript.${extension}`;
  },
  async saveChapterSummary(input: SaveChapterSummaryInput): Promise<string> {
    const record = getProjectRecord(input.projectPath);
    const relativePath = `summaries/${input.chapterId}.summary.json`;
    record.summaries[relativePath] = {
      chapterId: input.chapterId,
      chapterTitle: input.chapterTitle,
      result: input.result,
      savedAt: new Date().toISOString()
    };
    saveProjectRecord(record);
    return relativePath;
  }
};
