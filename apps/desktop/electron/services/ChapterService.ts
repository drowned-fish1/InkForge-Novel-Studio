import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import type { ChapterHistoryEntry, SaveChapterInput } from "../types.js";
import { FileRepository } from "./FileRepository.js";

const maxHistoryVersions = 50;

export class ChapterService {
  constructor(private readonly files = new FileRepository()) {}

  async saveChapter(input: SaveChapterInput): Promise<void> {
    const targetPath = this.files.assertInsideProject(input.projectPath, input.file);
    const previous = await this.files.readText(targetPath).catch(() => undefined);
    if (previous !== undefined && previous !== input.content) {
      await this.writeHistoryVersion(input.projectPath, input.file, previous);
    }
    await this.files.writeTextAtomic(targetPath, input.content);
  }

  async listHistoryOverview(projectPath: string, files: string[]): Promise<Record<string, ChapterHistoryEntry[]>> {
    const overview: Record<string, ChapterHistoryEntry[]> = {};
    for (const file of files) {
      overview[file] = await this.listHistoryVersions(projectPath, file);
    }
    return overview;
  }

  async listHistoryVersions(projectPath: string, file: string): Promise<ChapterHistoryEntry[]> {
    const dir = this.historyDir(projectPath, file);
    try {
      const names = (await readdir(dir)).filter((name) => name.endsWith(".md")).sort((a, b) => b.localeCompare(a));
      const entries: ChapterHistoryEntry[] = [];
      for (const name of names) {
        const filePath = path.join(dir, name);
        const stats = await stat(filePath);
        entries.push({
          id: name,
          createdAt: historyCreatedAt(name),
          size: stats.size
        });
      }
      return entries;
    } catch {
      return [];
    }
  }

  async readHistoryVersion(projectPath: string, file: string, historyId: string): Promise<string> {
    return this.files.readText(this.historyPath(projectPath, file, historyId));
  }

  async restoreHistoryVersion(projectPath: string, file: string, historyId: string): Promise<string> {
    const content = await this.readHistoryVersion(projectPath, file, historyId);
    await this.saveChapter({ projectPath, file, content });
    return content;
  }

  private async writeHistoryVersion(projectPath: string, file: string, content: string): Promise<void> {
    const dir = this.historyDir(projectPath, file);
    const fileName = `${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 8)}.md`;
    await this.files.writeTextAtomic(path.join(dir, fileName), content);
    await this.pruneHistory(dir);
  }

  private historyDir(projectPath: string, file: string): string {
    const normalized = file.replace(/\\/g, "/");
    const safeParts = normalized
      .split("/")
      .filter(Boolean)
      .map((part) => part.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_"));
    return this.files.assertInsideProject(projectPath, path.posix.join(".inkforge", "chapter-history", ...safeParts));
  }

  private historyPath(projectPath: string, file: string, historyId: string): string {
    if (!/^[\w.-]+\.md$/u.test(historyId)) {
      throw new Error("Invalid chapter history id.");
    }
    return path.join(this.historyDir(projectPath, file), historyId);
  }

  private async pruneHistory(dir: string): Promise<void> {
    const names = (await readdir(dir).catch(() => []))
      .filter((name) => name.endsWith(".md"))
      .sort((a, b) => b.localeCompare(a));
    for (const name of names.slice(maxHistoryVersions)) {
      await unlink(path.join(dir, name)).catch(() => undefined);
    }
  }
}

const historyCreatedAt = (id: string): string => {
  const raw = id.replace(/-[a-z0-9]{6}\.md$/iu, "").replace(/-(\d{3})$/u, ".$1");
  const iso = raw.replace(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/u, "$1-$2-$3T$4:$5:$6");
  return Number.isNaN(Date.parse(iso)) ? new Date().toISOString() : iso;
};
