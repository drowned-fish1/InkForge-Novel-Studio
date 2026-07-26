import { stat } from "node:fs/promises";
import path from "node:path";
import type { ProjectListItem, ProjectSummary } from "../types.js";
import { FileRepository } from "./FileRepository.js";

const maxRecentProjects = 20;

export class RecentProjectService {
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly registryPath: string,
    private readonly files = new FileRepository()
  ) {}

  async list(): Promise<ProjectListItem[]> {
    await this.mutationQueue;
    const records = await this.read();
    const available: ProjectListItem[] = [];
    for (const record of records) {
      const exists = await stat(record.projectPath)
        .then((entry) => entry.isDirectory())
        .catch(() => false);
      if (exists) {
        available.push(record);
      }
    }
    if (available.length !== records.length) {
      await this.enqueue(() => this.write(available));
    }
    return available;
  }

  async touch(project: ProjectSummary): Promise<void> {
    await this.enqueue(async () => {
      const records = await this.read();
      const key = projectKey(project.projectPath);
      const next: ProjectListItem = {
        projectPath: project.projectPath,
        title: project.meta.title,
        updatedAt: new Date().toISOString(),
        chapterCount: project.outline.volumes.reduce((count, volume) => count + volume.chapters.length, 0)
      };
      await this.write(
        [next, ...records.filter((record) => projectKey(record.projectPath) !== key)].slice(0, maxRecentProjects)
      );
    });
  }

  private async read(): Promise<ProjectListItem[]> {
    try {
      const raw = await this.files.readJson<unknown>(this.registryPath);
      if (!Array.isArray(raw)) {
        return [];
      }
      return raw.filter(isProjectListItem).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    } catch {
      return [];
    }
  }

  private async write(records: ProjectListItem[]): Promise<void> {
    await this.files.writeJsonAtomic(this.registryPath, records);
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const next = this.mutationQueue.catch(() => undefined).then(operation);
    this.mutationQueue = next.catch(() => undefined);
    return next;
  }
}

const projectKey = (projectPath: string): string => {
  const resolved = path.resolve(projectPath);
  return process.platform === "win32" ? resolved.toLocaleLowerCase() : resolved;
};

const isProjectListItem = (value: unknown): value is ProjectListItem => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Partial<ProjectListItem>;
  return (
    typeof record.projectPath === "string" &&
    typeof record.title === "string" &&
    typeof record.updatedAt === "string" &&
    typeof record.chapterCount === "number"
  );
};
