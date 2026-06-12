import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { createDefaultPromptTemplate, promptTemplateFileName, type PromptTask } from "@inkforge/prompt-engine";
import {
  createProjectId,
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
        style: input.style || "节奏快，冲突强，少解释，多行动",
        chapterWords: 3000
      }
    });

    const firstChapter: ChapterPlan = {
      id: "ch-0001",
      number: 1,
      title: "第一章 未命名",
      file: chapterFile(1, 1),
      goal: input.protagonist ? `介绍主角：${input.protagonist}` : "建立主角、冲突与第一处悬念",
      hook: "用一个明确问题推动读者进入下一章",
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
          goal: "建立世界、主角动机与核心冲突",
          targetWords: 90000,
          chapters: [firstChapter]
        }
      ]
    });

    await this.files.writeJsonAtomic(path.join(projectDir, "project.novel.json"), meta);
    await this.files.writeJsonAtomic(path.join(projectDir, "outline.json"), outline);
    await this.files.writeTextAtomic(
      path.join(projectDir, firstChapter.file),
      `# ${firstChapter.title}\n\n在这里开始写作。\n`
    );
    await this.seedProjectFiles(projectDir);

    return { projectPath: projectDir, meta, outline };
  }

  async openProject(projectDir: string): Promise<ProjectSummary> {
    const meta = ProjectMetaSchema.parse(await this.files.readJson(path.join(projectDir, "project.novel.json")));
    const outline = OutlineSchema.parse(await this.files.readJson(path.join(projectDir, "outline.json")));
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
    const chapter: ChapterPlan = {
      id: `ch-${String(nextNumber).padStart(4, "0")}`,
      number: nextNumber,
      title: input.title?.trim() || `第${nextNumber}章 未命名`,
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
    await this.files.writeTextAtomic(path.join(input.projectPath, chapter.file), `# ${chapter.title}\n\n`);

    return { ...summary, meta, outline };
  }

  async updateOutline(input: UpdateOutlineInput): Promise<ProjectSummary> {
    const summary = await this.openProject(input.projectPath);
    const outline = OutlineSchema.parse(input.outline);
    const meta = ProjectMetaSchema.parse({ ...summary.meta, updatedAt: toOffsetIso() });
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
    for (const dir of [
      projectDir,
      path.join(projectDir, "chapters", "volume-001"),
      path.join(projectDir, "summaries"),
      path.join(projectDir, "characters"),
      path.join(projectDir, "world"),
      path.join(projectDir, "prompts"),
      path.join(projectDir, "exports"),
      path.join(projectDir, ".inkforge")
    ]) {
      await mkdir(dir, { recursive: true });
    }
  }

  private async seedProjectFiles(projectDir: string): Promise<void> {
    await this.files.writeJsonAtomic(path.join(projectDir, "timeline.json"), []);
    await this.files.writeJsonAtomic(path.join(projectDir, "clues.json"), []);
    await this.files.writeJsonAtomic(path.join(projectDir, "terms.json"), []);
    await this.files.writeTextAtomic(path.join(projectDir, "world", "power-system.md"), "# 修炼体系\n\n");
    await this.files.writeJsonAtomic(path.join(projectDir, "world", "factions.json"), []);
    await this.files.writeJsonAtomic(path.join(projectDir, "world", "locations.json"), []);
    await this.files.writeJsonAtomic(path.join(projectDir, "characters", "char_main_protagonist.json"), {
      id: "char_main_protagonist",
      name: "主角",
      aliases: [],
      role: "protagonist",
      tags: ["主角"],
      profile: {
        age: "",
        identity: "",
        motivation: "",
        personality: ""
      },
      currentState: {
        arc: "第一卷",
        powerLevel: "",
        location: "",
        relationships: [],
        secrets: []
      },
      voiceNotes: ""
    });
    await this.files.writeJsonAtomic(path.join(projectDir, "world", "initial-world.world.json"), {
      id: "initial-world",
      title: "初始世界观",
      type: "note",
      locked: false,
      tags: ["待完善"],
      summary: "记录本书最重要的世界规则、地点和势力。",
      content: "",
      relatedCharacters: [],
      relatedClues: []
    });
    await this.files.writeJsonAtomic(path.join(projectDir, ".inkforge", "cache.json"), {});
    await this.files.writeJsonAtomic(path.join(projectDir, ".inkforge", "app-state.json"), {});
    for (const task of promptTasks) {
      await this.files.writeJsonAtomic(
        path.join(projectDir, "prompts", promptTemplateFileName(task)),
        createDefaultPromptTemplate(task)
      );
    }
  }
}
