import { createHash } from "node:crypto";
import type { ProjectData, EvidenceRef } from "@inkforge/schemas";
import { FileRepository } from "./FileRepository.js";

/** One request owns this cache; append-only changes can preserve exact source quotes. */
export class SourceEvidenceValidator {
  readonly warnings: string[] = [];
  private cache = new Map<string, Promise<string | undefined>>();
  constructor(
    private files: FileRepository,
    private project: string,
    private chapters: Array<{ id: string; file: string }>,
    seed?: { id: string; content: string }
  ) {
    if (seed) this.cache.set(seed.id, Promise.resolve(seed.content));
  }
  private read(id: string) {
    if (!this.cache.has(id)) {
      const chapter = this.chapters.find((item) => item.id === id);
      this.cache.set(
        id,
        chapter
          ? this.files.readText(this.files.assertInsideProject(this.project, chapter.file)).catch((error) => {
              if (error?.code === "ENOENT") return undefined;
              throw error;
            })
          : Promise.resolve(undefined)
      );
    }
    return this.cache.get(id)!;
  }
  async valid(ref: EvidenceRef, fullHash = false) {
    const text = await this.read(ref.chapterId);
    const valid =
      text !== undefined &&
      ref.startOffset >= 0 &&
      ref.endOffset > ref.startOffset &&
      ref.endOffset <= text.length &&
      text.slice(ref.startOffset, ref.endOffset) === ref.excerpt;
    if (!valid)
      this.warnings.push(`失效来源 ${ref.chapterId}:${ref.startOffset}-${ref.endOffset}：正文原句已变化或章节不存在。`);
    else if (fullHash && createHash("sha256").update(text!).digest("hex") !== ref.contentHash)
      this.warnings.push(`来源 ${ref.chapterId} 全文已变化，引用原句仍匹配；语义状态需核对。`);
    return valid;
  }
  async filter(refs: EvidenceRef[]) {
    const valid = await Promise.all(refs.map((ref) => this.valid(ref)));
    return refs.filter((_ref, index) => valid[index]);
  }
  async filterData(document: ProjectData): Promise<ProjectData> {
    const checked = await Promise.all(
      document.entries.map(
        async (entry) =>
          !entry.sources?.length ||
          (await Promise.all(entry.sources.map((ref) => this.valid(ref, true)))).every(Boolean)
      )
    );
    return { ...document, entries: document.entries.filter((_entry, index) => checked[index]) };
  }
}
