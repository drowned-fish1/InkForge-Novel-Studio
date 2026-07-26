import { randomUUID } from "node:crypto";
import { StoryBranchSchema, type BranchDiffLine, type StoryBranch } from "@inkforge/schemas";
import type { CreateStoryBranchInput, SaveStoryBranchInput } from "../types.js";
import { ChapterService } from "./ChapterService.js";
import { FileRepository } from "./FileRepository.js";
import { fingerprint } from "./QualityService.js";
import { ProjectService } from "./ProjectService.js";

export class BranchService {
  constructor(
    private readonly files = new FileRepository(),
    private readonly projects = new ProjectService(files),
    private readonly chapters = new ChapterService(files)
  ) {}

  async list(projectPath: string, chapterId?: string): Promise<StoryBranch[]> {
    const branches = await this.read(projectPath);
    return branches
      .filter((branch) => !chapterId || branch.chapterId === chapterId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async create(input: CreateStoryBranchInput): Promise<StoryBranch> {
    const chapter = await this.findChapter(input.projectPath, input.chapterId);
    const baseContent = await this.files.readText(this.files.assertInsideProject(input.projectPath, chapter.file));
    const now = new Date().toISOString();
    const branch = StoryBranchSchema.parse({
      id: randomUUID(),
      chapterId: input.chapterId,
      name: input.name.trim(),
      description: input.description ?? "",
      baseFingerprint: fingerprint(baseContent),
      baseContent,
      content: input.content ?? baseContent,
      status: "draft",
      source: input.source ?? "manual",
      createdAt: now,
      updatedAt: now
    });
    await this.write(input.projectPath, [branch, ...(await this.read(input.projectPath))]);
    return branch;
  }

  async save(input: SaveStoryBranchInput): Promise<StoryBranch> {
    const branches = await this.read(input.projectPath);
    const current = branches.find((branch) => branch.id === input.branchId);
    if (!current) {
      throw new Error("Story branch not found.");
    }
    const updated = StoryBranchSchema.parse({
      ...current,
      name: input.name?.trim() || current.name,
      description: input.description ?? current.description,
      content: input.content ?? current.content,
      updatedAt: new Date().toISOString()
    });
    await this.write(
      input.projectPath,
      branches.map((branch) => (branch.id === updated.id ? updated : branch))
    );
    return updated;
  }

  async compare(projectPath: string, branchId: string): Promise<BranchDiffLine[]> {
    const branch = (await this.read(projectPath)).find((item) => item.id === branchId);
    if (!branch) {
      throw new Error("Story branch not found.");
    }
    const chapter = await this.findChapter(projectPath, branch.chapterId);
    const current = await this.files.readText(this.files.assertInsideProject(projectPath, chapter.file));
    return diffLines(current, branch.content);
  }

  async apply(projectPath: string, branchId: string): Promise<StoryBranch> {
    const branches = await this.read(projectPath);
    const branch = branches.find((item) => item.id === branchId);
    if (!branch) {
      throw new Error("Story branch not found.");
    }
    const chapter = await this.findChapter(projectPath, branch.chapterId);
    await this.chapters.saveChapter({ projectPath, file: chapter.file, content: branch.content });
    const updated = StoryBranchSchema.parse({ ...branch, status: "applied", updatedAt: new Date().toISOString() });
    await this.write(
      projectPath,
      branches.map((item) => (item.id === updated.id ? updated : item))
    );
    return updated;
  }

  async archive(projectPath: string, branchId: string): Promise<StoryBranch> {
    const branches = await this.read(projectPath);
    const branch = branches.find((item) => item.id === branchId);
    if (!branch) {
      throw new Error("Story branch not found.");
    }
    const updated = StoryBranchSchema.parse({ ...branch, status: "archived", updatedAt: new Date().toISOString() });
    await this.write(
      projectPath,
      branches.map((item) => (item.id === updated.id ? updated : item))
    );
    return updated;
  }

  private async findChapter(projectPath: string, chapterId: string) {
    const project = await this.projects.openProject(projectPath);
    const chapter = project.outline.volumes.flatMap((volume) => volume.chapters).find((item) => item.id === chapterId);
    if (!chapter) {
      throw new Error("Chapter not found.");
    }
    return chapter;
  }

  private async read(projectPath: string): Promise<StoryBranch[]> {
    try {
      const raw = await this.files.readJson<unknown[]>(this.path(projectPath));
      return raw.map((item) => StoryBranchSchema.parse(item));
    } catch (error) {
      if (isMissingFile(error)) {
        return [];
      }
      throw error;
    }
  }

  private async write(projectPath: string, branches: StoryBranch[]): Promise<void> {
    await this.files.writeJsonAtomic(this.path(projectPath), branches);
  }

  private path(projectPath: string): string {
    return this.files.assertInsideProject(projectPath, ".inkforge/story-branches.json");
  }
}

const isMissingFile = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT";

export const diffLines = (before: string, after: string): BranchDiffLine[] => {
  const left = before.split(/\r?\n/u);
  const right = after.split(/\r?\n/u);
  const matrix = Array.from({ length: left.length + 1 }, () => Array<number>(right.length + 1).fill(0));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      matrix[i][j] = left[i] === right[j] ? matrix[i + 1][j + 1] + 1 : Math.max(matrix[i + 1][j], matrix[i][j + 1]);
    }
  }
  const result: BranchDiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      result.push({ kind: "context", text: left[i] });
      i += 1;
      j += 1;
    } else if (j < right.length && (i === left.length || matrix[i][j + 1] >= matrix[i + 1][j])) {
      result.push({ kind: "add", text: right[j] });
      j += 1;
    } else {
      result.push({ kind: "remove", text: left[i] });
      i += 1;
    }
  }
  return result;
};
