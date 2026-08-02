import { rm } from "node:fs/promises";
import path from "node:path";
import { OutlineSchema, type ChapterPlan, type VolumePlan } from "@inkforge/schemas";
import { CorpusImportService } from "./CorpusImportService.js";
import { FileRepository } from "./FileRepository.js";
import { ProjectService } from "./ProjectService.js";

export interface AdoptCorpusInput {
  projectPath: string;
  importId: string;
  volumeSize?: number;
  includeDuplicates?: boolean;
  volumeTitlePrefix?: string;
}

export interface CorpusAdoptionResult {
  importId: string;
  adoptedChapters: number;
  skippedDuplicates: number;
  alreadyAdopted: number;
  volumeIds: string[];
}

export class CorpusAdoptionService {
  constructor(
    private readonly files = new FileRepository(),
    private readonly projects = new ProjectService(files),
    private readonly imports = new CorpusImportService(files)
  ) {}

  async adopt(input: AdoptCorpusInput): Promise<CorpusAdoptionResult> {
    const manifest = await this.imports.get(input.projectPath, input.importId);
    if (!manifest) throw new Error(`Import not found: ${input.importId}`);
    if (manifest.status !== "completed") throw new Error("只能采纳已经完成的语料导入。");
    const project = await this.projects.openProject(input.projectPath);
    const existingChapters = project.outline.volumes.flatMap((volume) => volume.chapters);
    const adoptedRecordIds = new Set(
      existingChapters.flatMap((chapter) => {
        const match = /\[corpus:(.+?)\]/u.exec(chapter.notes);
        return match?.[1] ? [match[1]] : [];
      })
    );
    const includeDuplicates = input.includeDuplicates ?? false;
    const candidates = manifest.chapters.filter((chapter) => includeDuplicates || chapter.status !== "duplicate");
    const pending = candidates.filter((chapter) => !adoptedRecordIds.has(chapter.id));
    const alreadyAdopted = candidates.length - pending.length;
    const skippedDuplicates = includeDuplicates
      ? 0
      : manifest.chapters.filter((chapter) => chapter.status === "duplicate").length;
    if (!pending.length) {
      return { importId: input.importId, adoptedChapters: 0, skippedDuplicates, alreadyAdopted, volumeIds: [] };
    }

    const requestedVolumeSize = input.volumeSize ?? 100;
    if (!Number.isFinite(requestedVolumeSize)) throw new Error("每卷章节数必须是有限数字。");
    const volumeSize = Math.max(20, Math.min(500, Math.trunc(requestedVolumeSize)));
    const nextNumber = Math.max(0, ...existingChapters.map((chapter) => chapter.number)) + 1;
    const existingVolumeIds = new Set(project.outline.volumes.map((volume) => volume.id));
    const createdFiles: string[] = [];
    const volumes: VolumePlan[] = [];
    try {
      for (let offset = 0; offset < pending.length; offset += volumeSize) {
        const group = pending.slice(offset, offset + volumeSize);
        const volumeOrdinal = Math.floor(offset / volumeSize) + 1;
        const volumeId = uniqueId(
          `corpus-${safeId(input.importId)}-${String(volumeOrdinal).padStart(3, "0")}`,
          existingVolumeIds
        );
        existingVolumeIds.add(volumeId);
        const chapters: ChapterPlan[] = [];
        for (let index = 0; index < group.length; index += 1) {
          const record = group[index];
          const number = nextNumber + offset + index;
          const file = path.posix.join(
            "chapters",
            `volume-corpus-${safeId(input.importId)}-${String(volumeOrdinal).padStart(3, "0")}`,
            `ch-${String(number).padStart(5, "0")}.md`
          );
          const source = await this.files.readText(
            this.files.assertInsideProject(input.projectPath, record.contentPath)
          );
          await this.files.writeTextAtomic(this.files.assertInsideProject(input.projectPath, file), source);
          createdFiles.push(file);
          chapters.push({
            id: uniqueChapterId(record.id, existingChapters, chapters, volumes),
            number,
            title: record.title || `第 ${number} 章`,
            file,
            goal: "",
            hook: "",
            status: "done",
            targetWords: Math.max(1, record.charCount),
            actualWords: record.charCount,
            archived: false,
            notes: `[corpus:${record.id}] 来源：${record.sourcePath}`,
            conflictPoints: "",
            characters: [],
            worldRefs: []
          });
        }
        volumes.push({
          id: volumeId,
          title: `${input.volumeTitlePrefix?.trim() || "导入卷"} ${project.outline.volumes.length + volumeOrdinal}`,
          goal: "",
          targetWords: Math.max(
            1,
            chapters.reduce((total, chapter) => total + chapter.targetWords, 0)
          ),
          chapters
        });
      }
      const outline = OutlineSchema.parse({ ...project.outline, volumes: [...project.outline.volumes, ...volumes] });
      await this.projects.updateOutline({ projectPath: input.projectPath, outline });
    } catch (error) {
      let restored = false;
      try {
        await this.files.writeJsonAtomic(
          this.files.assertInsideProject(input.projectPath, "outline.json"),
          project.outline
        );
        await this.files.writeJsonAtomic(
          this.files.assertInsideProject(input.projectPath, "project.novel.json"),
          project.meta
        );
        restored = true;
      } catch {
        // Keep chapter files if metadata rollback fails: an outline that may reference them is safer than dangling paths.
      }
      if (restored) {
        await Promise.all(
          createdFiles.map((file) => rm(this.files.assertInsideProject(input.projectPath, file), { force: true }))
        );
      }
      throw error;
    }
    return {
      importId: input.importId,
      adoptedChapters: pending.length,
      skippedDuplicates,
      alreadyAdopted,
      volumeIds: volumes.map((volume) => volume.id)
    };
  }
}

const safeId = (value: string) => value.replace(/[^a-zA-Z0-9_-]/gu, "_").slice(0, 40) || "import";
const uniqueId = (base: string, used: Set<string>) => {
  let value = base;
  let attempt = 2;
  while (used.has(value)) value = `${base}-${attempt++}`;
  return value;
};
const uniqueChapterId = (base: string, existing: ChapterPlan[], current: ChapterPlan[], volumes: VolumePlan[]) => {
  const used = new Set([
    ...existing.map((chapter) => chapter.id),
    ...current.map((chapter) => chapter.id),
    ...volumes.flatMap((volume) => volume.chapters.map((chapter) => chapter.id))
  ]);
  return uniqueId(safeId(base), used);
};
