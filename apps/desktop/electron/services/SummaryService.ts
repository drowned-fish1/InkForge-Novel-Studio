import { readdir } from "node:fs/promises";
import path from "node:path";
import { ChapterSummarySchema, inkforgeSchemaVersion, type ChapterSummary } from "@inkforge/schemas";
import type { SaveChapterSummaryInput } from "../types.js";
import { FileRepository } from "./FileRepository.js";

const safeId = (value: string): string =>
  value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 80) || `summary-${Date.now()}`;

export class SummaryService {
  constructor(private readonly files = new FileRepository()) {}

  async saveChapterSummary(input: SaveChapterSummaryInput): Promise<string> {
    const summary = ChapterSummarySchema.parse({
      schemaVersion: inkforgeSchemaVersion,
      chapterId: input.chapterId,
      chapterTitle: input.chapterTitle,
      sourceTask: input.result.task,
      summaryText: input.result.task === "summary" ? input.result.text : "",
      rawOutput: input.result.text,
      providerId: input.result.providerId,
      model: input.result.model,
      contextSummary: input.result.contextSummary,
      generatedAt: input.result.generatedAt,
      savedAt: new Date().toISOString()
    });

    const relativePath = path.posix.join("summaries", `${safeId(input.chapterId)}.summary.json`);
    await this.files.writeJsonAtomic(this.files.assertInsideProject(input.projectPath, relativePath), summary);
    return relativePath;
  }

  async listSummaries(projectPath: string): Promise<
    Array<{
      id: string;
      chapterId: string;
      chapterTitle: string;
      task: string;
      model: string;
      savedAt: string;
      snippet: string;
    }>
  > {
    const dir = this.files.assertInsideProject(projectPath, "summaries");
    try {
      const names = await readdir(dir);
      const summaries: Array<{
        id: string;
        chapterId: string;
        chapterTitle: string;
        task: string;
        model: string;
        savedAt: string;
        snippet: string;
      }> = [];
      for (const name of names.filter((n) => n.endsWith(".summary.json"))) {
        try {
          const entry = await this.files.readJson<ChapterSummary>(path.join(dir, name));
          const rawText = entry.rawOutput || entry.summaryText || "";
          summaries.push({
            id: name,
            chapterId: entry.chapterId,
            chapterTitle: entry.chapterTitle,
            task: entry.sourceTask ?? "summary",
            model: entry.model ?? "",
            savedAt: entry.savedAt,
            snippet: rawText.slice(0, 150)
          });
        } catch {
          // skip corrupted files
        }
      }
      return summaries.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    } catch {
      return [];
    }
  }
}
