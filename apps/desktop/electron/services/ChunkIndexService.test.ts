import { readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ChunkIndexService, type IndexedChunk } from "./ChunkIndexService.js";
import { FileRepository } from "./FileRepository.js";
import { HybridRetriever } from "./HybridRetriever.js";

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

const createRoot = async (): Promise<string> => {
  const root = await (await import("node:fs/promises")).mkdtemp(path.join(os.tmpdir(), "inkforge-chunk-"));
  roots.push(root);
  return root;
};

const repeatedChapter = (tail: string): string =>
  `${"前段铺垫。人物在旧城中追查一封没有署名的信。".repeat(20)}\n\n${"中段冲突。守门人说起被删去的航线和失踪的船。".repeat(20)}\n\n${tail}`;

describe("ChunkIndexService", () => {
  it("chunks a long chapter and recalls text from the latter half with offsets and hashes", async () => {
    const root = await createRoot();
    const service = new ChunkIndexService();
    const content = repeatedChapter("后半段唯一线索：黑曜石钥匙藏在北塔地窖。".repeat(30));
    const result = await service.indexChapter(root, {
      chapterId: "ch-0001",
      title: "雾港",
      content
    });

    expect(result.changed).toBe(true);
    expect(result.chunks.length).toBeGreaterThan(1);
    expect(result.chunks.slice(0, -1).every((chunk) => chunk.text.length >= 600 && chunk.text.length <= 1_200)).toBe(
      true
    );
    expect(result.chunks.at(-1)?.text.length).toBeGreaterThanOrEqual(600);
    expect(result.chunks.every((chunk) => chunk.endOffset <= content.length)).toBe(true);
    expect(result.chunks.some((chunk) => chunk.endOffset > content.length / 2)).toBe(true);
    expect(result.chunks.every((chunk) => content.slice(chunk.startOffset, chunk.endOffset) === chunk.text)).toBe(true);

    const retriever = new HybridRetriever(service);
    const search = await retriever.search(root, "黑曜石钥匙", { mode: "lexical", limit: 5 });
    expect(search.mode).toBe("lexical");
    expect(search.hits[0]?.chapterId).toBe("ch-0001");
    expect(search.hits[0]?.source.startOffset).toBeGreaterThan(content.length / 2);
    const source = search.hits[0]?.source;
    expect(source).toBeDefined();
    expect(source && content.slice(source.startOffset, source.endOffset)).toContain("黑曜石钥匙");
    expect(source?.contentHash).toBe(search.hits[0]?.contentHash);
  });

  it("updates only the changed chapter and keeps other chapter chunks intact", async () => {
    const root = await createRoot();
    const service = new ChunkIndexService();
    const first = await service.indexChapter(root, {
      chapterId: "ch-0001",
      title: "第一章",
      content: "第一章内容。".repeat(120)
    });
    const second = await service.indexChapter(root, {
      chapterId: "ch-0002",
      title: "第二章",
      content: "第二章原始内容。".repeat(120)
    });
    const oldSecond = second.chunks.map((chunk) => chunk.contentHash);
    const unchanged = await service.updateChapter(root, {
      chapterId: "ch-0001",
      title: "第一章",
      content: "第一章内容。".repeat(120)
    });
    expect(unchanged.changed).toBe(false);
    expect(unchanged.generation).toBe(second.generation);

    const changed = await service.updateChapter(root, {
      chapterId: "ch-0001",
      title: "第一章",
      content: "第一章修改后出现的新线索。".repeat(120)
    });
    expect(changed.changed).toBe(true);
    expect(changed.generation).toBeGreaterThan(second.generation);
    expect(changed.chunks.some((chunk) => chunk.contentHash !== first.chunks[0]?.contentHash)).toBe(true);
    const all = await service.getChunks(root);
    expect(all.filter((chunk) => chunk.chapterId === "ch-0002").map((chunk) => chunk.contentHash)).toEqual(oldSecond);
    expect(
      all
        .filter((chunk) => chunk.chapterId === "ch-0001")
        .every((chunk) => chunk.chapterContentHash === changed.contentHash)
    ).toBe(true);
  });

  it("loads persisted chunks after a process restart without reading chapter source", async () => {
    const root = await createRoot();
    const content = "重启后仍可检索的证据。".repeat(130);
    const firstService = new ChunkIndexService();
    await firstService.indexChapter(root, { chapterId: "ch-restart", title: "重启", content });
    firstService.clearCache(root);

    const restarted = new ChunkIndexService();
    const chunks = await restarted.getChunks(root);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.text.length > 0)).toBe(true);
    const retriever = new HybridRetriever(restarted);
    const result = await retriever.search(root, "重启后仍可检索", { mode: "lexical" });
    expect(result.hits[0]?.source.chapterId).toBe("ch-restart");

    const manifest = await restarted.getManifest(root);
    const manifestPath = path.join(root, ".inkforge", "continuation", "chunk-index", "manifest.json");
    expect(JSON.parse(await readFile(manifestPath, "utf8")).totalChunks).toBe(manifest.totalChunks);
    expect((await stat(manifestPath)).isFile()).toBe(true);
  });

  it("supports explicit scenes and keeps their identifiers on evidence", async () => {
    const root = await createRoot();
    const service = new ChunkIndexService();
    const content = "场景甲开始。".repeat(130) + "场景乙开始。".repeat(130);
    const pivot = "场景甲开始。".repeat(130).length;
    const result = await service.indexChapter(root, {
      chapterId: "ch-scenes",
      title: "场景",
      content,
      scenes: [
        { id: "scene-a", startOffset: 0, endOffset: pivot },
        { id: "scene-b", startOffset: pivot, endOffset: content.length }
      ]
    });
    expect(result.chunks.some((chunk) => chunk.sceneId === "scene-b")).toBe(true);
    const result2 = await new HybridRetriever(service).search(root, "场景乙开始", {
      sceneIds: ["scene-b"],
      mode: "lexical"
    });
    expect(result2.hits.length).toBeGreaterThan(0);
    expect(result2.hits.every((hit) => hit.sceneId === "scene-b")).toBe(true);
  });
});

describe("HybridRetriever", () => {
  it("labels lexical and semantic modes and ranks exact lexical evidence first", async () => {
    const root = await createRoot();
    const service = new ChunkIndexService();
    await service.indexChapters(root, [
      { chapterId: "a", title: "甲", content: "远方的城门映着雪光。".repeat(100) },
      { chapterId: "b", title: "乙", content: "城门开启的代价是交出黑曜石钥匙。".repeat(100) }
    ]);
    const retriever = new HybridRetriever(service);
    const lexical = await retriever.search(root, "黑曜石钥匙", { mode: "lexical" });
    expect(lexical.mode).toBe("lexical");
    expect(lexical.hits[0]?.chapterId).toBe("b");
    expect(lexical.hits[0]?.retrievalMode).toBe("lexical");

    const semantic = await retriever.search(root, "开启城门", { mode: "semantic" });
    expect(semantic.mode).toBe("semantic");
    expect(semantic.semanticAvailable).toBe(true);
    expect(semantic.hits.every((hit) => hit.mode === "semantic")).toBe(true);
  });

  it("accepts a pluggable embedding provider and records its generation", async () => {
    const root = await createRoot();
    let calls = 0;
    const provider = {
      id: "test-embedding-v1",
      dimensions: 3,
      embed: (value: string) => {
        calls += 1;
        return [value.includes("星门") ? 1 : 0, value.includes("钥匙") ? 1 : 0, 0];
      }
    };
    const service = new ChunkIndexService(new FileRepository(), { embeddingProvider: provider });
    await service.indexChapter(root, { chapterId: "custom", title: "自定义", content: "星门与钥匙。".repeat(100) });
    const result = await new HybridRetriever(service).search(root, "星门", { mode: "semantic" });
    expect(calls).toBeGreaterThan(1);
    expect(result.semanticAvailable).toBe(true);
    expect(result.embeddingProviderId).toBe("test-embedding-v1");
    expect((await service.getStats(root)).embeddingProviderId).toBe("test-embedding-v1");
  });
});

// Keep this import-level type assertion close to the tests so a future schema
// change cannot accidentally make persisted chunks lose their source fields.
const _indexedChunkFields: Array<keyof IndexedChunk> = [
  "chapterId",
  "startOffset",
  "endOffset",
  "contentHash",
  "chapterContentHash"
];
void _indexedChunkFields;
