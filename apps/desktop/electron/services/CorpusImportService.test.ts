import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CorpusImportService, detectEncoding } from "./CorpusImportService.js";
import { FileRepository } from "./FileRepository.js";

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

const createRoot = async (name: string): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), `inkforge-${name}-`));
  roots.push(root);
  return root;
};

describe("CorpusImportService", () => {
  it("streams a UTF-8 BOM manuscript, splits chapters and persists hashes", async () => {
    const root = await createRoot("corpus-utf8");
    const source = path.join(root, "source.txt");
    await writeFile(source, "\ufeff# 第一章 雨夜\n甲在窗边。\n\n# 第二章 天明\n乙推门而入。\n", "utf8");
    const projectPath = path.join(root, "project");
    const service = new CorpusImportService(new FileRepository());

    const manifest = await service.import({ projectPath, sourcePath: source });

    expect(manifest.status).toBe("completed");
    expect(manifest.encoding).toBe("utf8");
    expect(manifest.encodingConfidence).toBeGreaterThan(0.9);
    expect(manifest.chapters.map((chapter) => chapter.title)).toEqual(["第一章 雨夜", "第二章 天明"]);
    expect(manifest.chapters.every((chapter) => /^[a-f0-9]{64}$/u.test(chapter.contentHash))).toBe(true);
    const first = manifest.chapters[0];
    const stored = await readFile(path.join(projectPath, first.contentPath), "utf8");
    expect(stored).toContain("甲在窗边");
    expect(stored.charCodeAt(0)).not.toBe(0xfeff);
    expect(manifest.checkpoint.nextSourceIndex).toBe(1);
  });

  it("falls back to GB18030 for an invalid UTF-8 probe", async () => {
    const root = await createRoot("corpus-gb");
    const source = path.join(root, "source.txt");
    // GB18030 bytes for 中文.  The ASCII heading remains readable in either encoding.
    await writeFile(source, Buffer.concat([Buffer.from("# 第一章\n", "ascii"), Buffer.from([0xd6, 0xd0, 0xce, 0xc4])]));
    const detection = detectEncoding(await readFile(source));
    expect(detection.encoding).toBe("gb18030");
    const projectPath = path.join(root, "project");
    const service = new CorpusImportService(new FileRepository());
    const manifest = await service.import({ projectPath, sourcePath: source });
    const stored = await readFile(path.join(projectPath, manifest.chapters[0].contentPath), "utf8");
    expect(stored).toContain("中文");
  });

  it("does not silently overwrite a duplicate chapter across imports", async () => {
    const root = await createRoot("corpus-duplicate");
    const projectPath = path.join(root, "project");
    const firstSource = path.join(root, "first.txt");
    const secondSource = path.join(root, "second.txt");
    await writeFile(firstSource, "# 第一章\n相同正文\n", "utf8");
    await writeFile(secondSource, "# 第一章\n相同正文\n", "utf8");
    const service = new CorpusImportService(new FileRepository());
    const first = await service.import({ projectPath, sourcePath: firstSource });
    const second = await service.import({ projectPath, sourcePath: secondSource });
    expect(second.chapters[0].status).toBe("duplicate");
    expect(second.chapters[0].duplicateOf).toBe(first.chapters[0].id);
    expect(second.chapters[0].contentPath).not.toBe(first.chapters[0].contentPath);
    expect(second.duplicateChapterIds).toContain(second.chapters[0].id);
  });

  it("pauses after a checkpoint and a fresh service resumes the remaining chapters", async () => {
    const root = await createRoot("corpus-resume");
    const projectPath = path.join(root, "project");
    const source = path.join(root, "source.md");
    await writeFile(source, "# 第一章\n一\n# 第二章\n二\n# 第三章\n三\n", "utf8");
    const files = new FileRepository();
    const service = new CorpusImportService(files);
    let paused = false;
    const partial = await service.import({
      projectPath,
      sourcePath: source,
      onProgress: async (progress) => {
        if (!paused && progress.completedChapters === 1 && progress.status === "running") {
          paused = true;
          await service.pause(projectPath, progress.importId);
        }
      }
    });
    expect(partial.status).toBe("paused");
    expect(partial.chapters).toHaveLength(1);
    const restarted = new CorpusImportService(files);
    const resumed = await restarted.resume(projectPath, partial.id);
    expect(resumed.status).toBe("completed");
    expect(resumed.chapters).toHaveLength(3);
    expect(new Set(resumed.chapters.map((chapter) => chapter.key)).size).toBe(3);
  });

  it("persists cancellation and leaves completed chapters intact", async () => {
    const root = await createRoot("corpus-cancel");
    const projectPath = path.join(root, "project");
    const source = path.join(root, "source.md");
    await writeFile(source, "# 第一章\n一\n# 第二章\n二\n", "utf8");
    const service = new CorpusImportService(new FileRepository());
    const cancelled = await service.import({
      projectPath,
      sourcePath: source,
      onProgress: async (progress) => {
        if (progress.completedChapters === 1 && progress.status === "running") {
          await service.cancel(projectPath, progress.importId);
        }
      }
    });
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.chapters).toHaveLength(1);
    expect((await service.get(projectPath, cancelled.id))?.status).toBe("cancelled");
  });
});
