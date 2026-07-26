import { mkdir, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { createDefaultPromptTemplate, promptTemplateFileName, type PromptTask } from "@inkforge/prompt-engine";
import {
  createProjectId,
  defaultAgentMembers,
  inkforgeSchemaVersion,
  OutlineSchema,
  ProjectMetaSchema,
  type ChapterPlan,
  type Outline,
  type ProjectMeta
} from "@inkforge/schemas";
import type { CreateChapterInput, CreateProjectInput, ProjectSummary, UpdateOutlineInput } from "../types.js";
import { FileRepository } from "./FileRepository.js";

const toOffsetIso = (date = new Date()): string => {
  const pad = (value: number) => String(Math.abs(Math.trunc(value))).padStart(2, "0");
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const hours = pad(offsetMinutes / 60);
  const minutes = pad(offsetMinutes % 60);
  return `${date.toISOString().slice(0, 19)}${sign}${hours}:${minutes}`;
};

const slugPart = (value: string): string =>
  value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 48) || "untitled";

const chapterFile = (volumeNumber: number, chapterNumber: number): string =>
  path.posix.join(
    "chapters",
    `volume-${String(volumeNumber).padStart(3, "0")}`,
    `ch-${String(chapterNumber).padStart(4, "0")}.md`
  );

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

export const suggestChapterTitle = (chapterNumber: number, previous?: Pick<ChapterPlan, "goal" | "hook">): string => {
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
  "clue-check",
  "term-check",
  "polish",
  "typo",
  "pre-export"
];

const legacyPremises = new Set([
  "边城少年得到父亲留下的黑匣，发现自身血脉与失落星火有关。",
  "边城少年林烬在父亲失踪后得到黑匣，发现体内藏着失落星火血脉。"
]);
const legacyChapterGoals = new Set(["介绍主角：林烬，边城少年，寻找失踪父亲", "建立主角、冲突与第一处悬念"]);
const legacyChapterHook = "用一个明确问题推动读者进入下一章";
const legacyVolumeGoal = "建立世界、主角动机与核心冲突";

export const sanitizeLegacyOutline = (outline: Outline): Outline => {
  const next = structuredClone(outline);
  if (legacyPremises.has(next.premise)) {
    next.premise = "";
  }
  for (const volume of next.volumes) {
    if (volume.goal === legacyVolumeGoal) {
      volume.goal = "";
    }
    for (const chapter of volume.chapters) {
      if (legacyChapterGoals.has(chapter.goal)) {
        chapter.goal = "";
      }
      if (chapter.hook === legacyChapterHook) {
        chapter.hook = "";
      }
    }
  }
  return OutlineSchema.parse(next);
};

export class ProjectService {
  constructor(private readonly files = new FileRepository()) {}

  async createProject(parentDir: string, input: CreateProjectInput): Promise<ProjectSummary> {
    const now = toOffsetIso();
    const projectDir = path.join(parentDir, slugPart(input.title));
    await this.createProjectShape(projectDir);

    const meta: ProjectMeta = ProjectMetaSchema.parse({
      schemaVersion: inkforgeSchemaVersion,
      projectId: createProjectId(input.title),
      title: input.title,
      author: input.author || "local-user",
      genre: input.genre,
      targetWords: input.targetWords,
      createdAt: now,
      updatedAt: now,
      writingPreferences: {
        style: input.style || "",
        chapterWords: 3000
      }
    });

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

    const outline: Outline = OutlineSchema.parse({
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
    });

    await this.files.writeJsonAtomic(path.join(projectDir, "project.novel.json"), meta);
    await this.files.writeJsonAtomic(path.join(projectDir, "outline.json"), outline);
    await this.files.writeTextAtomic(path.join(projectDir, firstChapter.file), "");
    await this.seedProjectFiles(projectDir);

    return { projectPath: projectDir, meta, outline };
  }

  async openProject(projectDir: string): Promise<ProjectSummary> {
    const meta = ProjectMetaSchema.parse(await this.files.readJson(path.join(projectDir, "project.novel.json")));
    const rawOutline = OutlineSchema.parse(await this.files.readJson(path.join(projectDir, "outline.json")));
    const outline = sanitizeLegacyOutline(rawOutline);
    if (JSON.stringify(outline) !== JSON.stringify(rawOutline)) {
      await this.files.writeJsonAtomic(path.join(projectDir, "outline.json"), outline);
    }
    await this.cleanupLegacySeedFiles(projectDir, outline);
    return { projectPath: projectDir, meta, outline };
  }

  async createChapter(input: CreateChapterInput): Promise<ProjectSummary> {
    const summary = await this.openProject(input.projectPath);
    const volume = summary.outline.volumes.find((item) => item.id === input.volumeId);
    if (!volume) {
      throw new Error("Volume not found.");
    }

    const maxChapterNumber = Math.max(
      0,
      ...summary.outline.volumes.flatMap((item) => item.chapters.map((chapter) => chapter.number))
    );
    const nextNumber = maxChapterNumber + 1;
    const volumeNumber = summary.outline.volumes.findIndex((item) => item.id === input.volumeId) + 1;
    const previousChapter = volume.chapters.at(-1);
    const chapter: ChapterPlan = {
      id: `ch-${String(nextNumber).padStart(4, "0")}`,
      number: nextNumber,
      title: input.title?.trim() || suggestChapterTitle(nextNumber, previousChapter),
      file: chapterFile(volumeNumber, nextNumber),
      goal: "",
      hook: "",
      status: "drafting",
      targetWords: summary.meta.writingPreferences.chapterWords,
      actualWords: 0,
      archived: false,
      notes: "",
      conflictPoints: "",
      characters: [],
      worldRefs: []
    };

    volume.chapters.push(chapter);
    summary.meta.updatedAt = toOffsetIso();
    const outline = OutlineSchema.parse(summary.outline);
    const meta = ProjectMetaSchema.parse(summary.meta);
    await this.files.writeJsonAtomic(path.join(input.projectPath, "outline.json"), outline);
    await this.files.writeJsonAtomic(path.join(input.projectPath, "project.novel.json"), meta);
    await this.files.writeTextAtomic(path.join(input.projectPath, chapter.file), "");

    return { ...summary, meta, outline };
  }

  async updateOutline(input: UpdateOutlineInput): Promise<ProjectSummary> {
    const summary = await this.openProject(input.projectPath);
    const outline = OutlineSchema.parse(input.outline);
    const meta = ProjectMetaSchema.parse({ ...summary.meta, updatedAt: toOffsetIso() });
    for (const chapter of outline.volumes.flatMap((volume) => volume.chapters)) {
      const chapterPath = this.files.assertInsideProject(input.projectPath, chapter.file);
      try {
        await this.files.readText(chapterPath);
      } catch (error) {
        if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") {
          throw error;
        }
        await this.files.writeTextAtomic(chapterPath, "");
      }
    }
    await this.files.writeJsonAtomic(path.join(input.projectPath, "outline.json"), outline);
    await this.files.writeJsonAtomic(path.join(input.projectPath, "project.novel.json"), meta);
    return { ...summary, meta, outline };
  }

  async inspectProject(projectDir: string): Promise<string[]> {
    const issues: string[] = [];
    const names = new Set(await readdir(projectDir));
    for (const required of ["project.novel.json", "outline.json", "chapters", "characters", "world", "prompts"]) {
      if (!names.has(required)) {
        issues.push(`缺少 ${required}`);
      }
    }
    return issues;
  }

  private async createProjectShape(projectDir: string): Promise<void> {
    try {
      await mkdir(projectDir);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
        throw new Error(`目标项目文件夹已存在：${projectDir}。请更换书名或保存位置。`);
      }
      throw error;
    }
    for (const dir of [
      path.join(projectDir, "chapters", "volume-001"),
      path.join(projectDir, "summaries"),
      path.join(projectDir, "characters"),
      path.join(projectDir, "world"),
      path.join(projectDir, "prompts"),
      path.join(projectDir, "exports"),
      path.join(projectDir, ".inkforge"),
      path.join(projectDir, ".inkforge", "backups")
    ]) {
      await mkdir(dir, { recursive: true });
    }
  }

  private async seedProjectFiles(projectDir: string): Promise<void> {
    await this.files.writeJsonAtomic(path.join(projectDir, "timeline.json"), []);
    await this.files.writeJsonAtomic(path.join(projectDir, "clues.json"), []);
    await this.files.writeJsonAtomic(path.join(projectDir, "terms.json"), []);
    await this.files.writeJsonAtomic(path.join(projectDir, "world", "factions.json"), []);
    await this.files.writeJsonAtomic(path.join(projectDir, "world", "locations.json"), []);
    await this.files.writeJsonAtomic(path.join(projectDir, ".inkforge", "cache.json"), {});
    await this.files.writeJsonAtomic(path.join(projectDir, ".inkforge", "app-state.json"), {});
    await this.files.writeJsonAtomic(path.join(projectDir, ".inkforge", "writing-workspace.json"), {
      annotations: [],
      bookmarks: [],
      sessions: []
    });
    await this.files.writeJsonAtomic(path.join(projectDir, ".inkforge", "agent-extensions.json"), {
      promptPresets: [],
      toolProfiles: [],
      customTools: [],
      members: defaultAgentMembers
    });
    for (const task of promptTasks) {
      await this.files.writeJsonAtomic(
        path.join(projectDir, "prompts", promptTemplateFileName(task)),
        createDefaultPromptTemplate(task)
      );
    }
  }

  private async cleanupLegacySeedFiles(projectDir: string, outline: Outline): Promise<void> {
    const removeJsonIf = async (
      relativeFile: string,
      predicate: (value: Record<string, unknown>) => boolean
    ): Promise<void> => {
      const filePath = this.files.assertInsideProject(projectDir, relativeFile);
      try {
        const value = await this.files.readJson<Record<string, unknown>>(filePath);
        if (predicate(value)) {
          await unlink(filePath);
        }
      } catch {
        // Missing or user-modified legacy seed files are left untouched.
      }
    };
    await removeJsonIf("characters/char_main_protagonist.json", (value) => {
      const profile = value.profile as Record<string, unknown> | undefined;
      const currentState = value.currentState as Record<string, unknown> | undefined;
      const relationships = Array.isArray(currentState?.relationships) ? currentState.relationships : [];
      const secrets = Array.isArray(currentState?.secrets) ? currentState.secrets : [];
      return (
        value.id === "char_main_protagonist" &&
        value.name === "主角" &&
        !Object.values(profile ?? {}).some(Boolean) &&
        !String(currentState?.powerLevel ?? "").trim() &&
        !String(currentState?.location ?? "").trim() &&
        !relationships.length &&
        !secrets.length &&
        !String(value.voiceNotes ?? "").trim()
      );
    });
    await removeJsonIf(
      "world/initial-world.world.json",
      (value) => value.id === "initial-world" && value.title === "初始世界观" && !String(value.content ?? "").trim()
    );
    const powerSystemPath = this.files.assertInsideProject(projectDir, "world/power-system.md");
    try {
      const content = await this.files.readText(powerSystemPath);
      if (content.trim() === "# 修炼体系") {
        await unlink(powerSystemPath);
      }
    } catch {
      // The optional legacy placeholder does not exist.
    }
    const firstChapter = outline.volumes.flatMap((volume) => volume.chapters)[0];
    if (firstChapter) {
      const chapterPath = this.files.assertInsideProject(projectDir, firstChapter.file);
      try {
        const content = await this.files.readText(chapterPath);
        if (content === `# ${firstChapter.title}\n\n在这里开始写作。\n`) {
          await this.files.writeTextAtomic(chapterPath, "");
        }
      } catch {
        // Existing manuscript content is never altered.
      }
    }
  }
}
