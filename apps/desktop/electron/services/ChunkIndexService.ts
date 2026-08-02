import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { createLocalSemanticVector } from "./SemanticIndexService.js";
import { FileRepository } from "./FileRepository.js";

/**
 * A source location that can be used to jump back to the manuscript.
 *
 * Offsets are JavaScript string offsets (UTF-16 code units), the same unit
 * used by the editor and by ProjectSearchService.  Keeping this explicit is
 * important for Chinese text mixed with emoji and other astral characters.
 */
export interface EvidenceRef {
  chapterId: string;
  sceneId?: string;
  startOffset: number;
  endOffset: number;
  excerpt: string;
  contentHash: string;
}

export interface ChunkSceneInput {
  id: string;
  startOffset: number;
  endOffset: number;
  title?: string;
}

export interface IndexChapterInput {
  chapterId: string;
  title: string;
  /** The chapter body. `text` is accepted as a convenient alias. */
  content?: string;
  text?: string;
  volumeId?: string;
  volumeTitle?: string;
  chapterNumber?: number;
  scenes?: ChunkSceneInput[];
}

export interface EmbeddingProvider {
  /** Stable provider/model name persisted with each generation. */
  readonly id: string;
  readonly dimensions?: number;
  embed(text: string): number[] | readonly number[] | Promise<number[] | readonly number[]>;
}

export interface ChunkIndexOptions {
  /** Target chunk size. The splitter keeps chunks between min/max where possible. */
  targetCharacters?: number;
  minCharacters?: number;
  maxCharacters?: number;
  overlapCharacters?: number;
  embeddingProvider?: EmbeddingProvider;
  /** Relative to the project root; useful for migration/tests. */
  indexDirectory?: string;
}

export interface IndexedChunk {
  id: string;
  chapterId: string;
  chapterTitle: string;
  volumeId?: string;
  volumeTitle?: string;
  chapterNumber?: number;
  sceneId?: string;
  sceneTitle?: string;
  chunkIndex: number;
  startOffset: number;
  endOffset: number;
  /** The exact text represented by this chunk, not a truncated preview. */
  text: string;
  /** Hash of this exact chunk text. */
  contentHash: string;
  /** Hash of the complete chapter at index time. */
  chapterContentHash: string;
  vector: number[];
}

export interface IndexedChapterMetadata {
  chapterId: string;
  title: string;
  volumeId?: string;
  volumeTitle?: string;
  chapterNumber?: number;
  contentHash: string;
  contentLength: number;
  chunkCount: number;
  chunkFile: string;
  updatedAt: string;
}

export interface ChunkIndexManifest {
  version: 1;
  generation: number;
  updatedAt: string;
  embeddingProviderId: string;
  embeddingDimensions: number;
  totalChunks: number;
  chapters: Record<string, IndexedChapterMetadata>;
}

export interface ChunkIndexUpdateResult {
  chapterId: string;
  changed: boolean;
  contentHash: string;
  chunks: IndexedChunk[];
  indexedChunks: number;
  totalChunks: number;
  generation: number;
}

export interface ChunkIndexStats {
  generation: number;
  chapters: number;
  chunks: number;
  embeddingProviderId: string;
  embeddingDimensions: number;
}

interface PersistedChapterChunks {
  version: 1;
  chapterId: string;
  title: string;
  contentHash: string;
  chunks: IndexedChunk[];
}

interface LoadedIndex {
  manifest: ChunkIndexManifest;
  chunksByChapter: Map<string, IndexedChunk[]>;
}

const defaultTargetCharacters = 800;
const defaultMinCharacters = 600;
const defaultMaxCharacters = 1_200;
const defaultOverlapCharacters = 80;
const hashVectorDimensions = 384;

/** Deterministic local fallback. It is semantic retrieval, but not a model embedding. */
export const localHashEmbeddingProvider: EmbeddingProvider = {
  id: "local-hash-v1",
  dimensions: hashVectorDimensions,
  embed: (text) => createLocalSemanticVector(text)
};

/** Alias kept explicit for callers that want to identify the fallback vector. */
export const createHashEmbedding = (text: string): number[] => createLocalSemanticVector(text);

export class ChunkIndexService {
  private readonly options: Required<
    Pick<ChunkIndexOptions, "targetCharacters" | "minCharacters" | "maxCharacters" | "overlapCharacters">
  > &
    Omit<ChunkIndexOptions, "targetCharacters" | "minCharacters" | "maxCharacters" | "overlapCharacters">;
  private readonly loaded = new Map<string, LoadedIndex>();

  constructor(
    private readonly files = new FileRepository(),
    options: ChunkIndexOptions = {}
  ) {
    this.options = {
      targetCharacters: options.targetCharacters ?? defaultTargetCharacters,
      minCharacters: options.minCharacters ?? defaultMinCharacters,
      maxCharacters: options.maxCharacters ?? defaultMaxCharacters,
      overlapCharacters: options.overlapCharacters ?? defaultOverlapCharacters,
      embeddingProvider: options.embeddingProvider ?? localHashEmbeddingProvider,
      indexDirectory: options.indexDirectory
    };
    if (this.options.minCharacters < 1 || this.options.maxCharacters < this.options.minCharacters) {
      throw new Error("Invalid chunk size range.");
    }
    if (
      this.options.targetCharacters < this.options.minCharacters ||
      this.options.targetCharacters > this.options.maxCharacters
    ) {
      throw new Error("Chunk target must be between minCharacters and maxCharacters.");
    }
    if (this.options.overlapCharacters < 0 || this.options.overlapCharacters >= this.options.maxCharacters) {
      throw new Error("Invalid chunk overlap.");
    }
  }

  get embeddingProvider(): EmbeddingProvider {
    return this.options.embeddingProvider ?? localHashEmbeddingProvider;
  }

  /** Index one chapter without reading any other chapter's manuscript. */
  async indexChapter(projectPath: string, input: IndexChapterInput): Promise<ChunkIndexUpdateResult>;
  async indexChapter(
    projectPath: string,
    chapterId: string,
    title: string,
    content: string,
    metadata?: Omit<IndexChapterInput, "chapterId" | "title" | "content" | "text">
  ): Promise<ChunkIndexUpdateResult>;
  async indexChapter(projectPath: string, chapterId: string, content: string): Promise<ChunkIndexUpdateResult>;
  async indexChapter(
    projectPath: string,
    inputOrChapterId: IndexChapterInput | string,
    titleOrContent?: string,
    contentOrUndefined?: string,
    metadata?: Omit<IndexChapterInput, "chapterId" | "title" | "content" | "text">
  ): Promise<ChunkIndexUpdateResult> {
    const input = normalizeChapterInput(inputOrChapterId, titleOrContent, contentOrUndefined, metadata);
    const projectKey = path.resolve(projectPath);
    const index = await this.ensureLoaded(projectKey);
    const content = input.content ?? input.text ?? "";
    const contentHash = hashText(content);
    const previous = index.manifest.chapters[input.chapterId];
    const existing = index.chunksByChapter.get(input.chapterId) ?? [];

    // Avoid touching the chapter file or manifest for an unchanged save.
    if (
      previous &&
      previous.contentHash === contentHash &&
      previous.title === input.title &&
      previous.volumeId === input.volumeId &&
      previous.volumeTitle === input.volumeTitle &&
      previous.chapterNumber === input.chapterNumber &&
      existing.length === previous.chunkCount
    ) {
      return {
        chapterId: input.chapterId,
        changed: false,
        contentHash,
        chunks: existing.slice(),
        indexedChunks: existing.length,
        totalChunks: index.manifest.totalChunks,
        generation: index.manifest.generation
      };
    }

    const chunks = await createChunks(input, content, contentHash, this.options);
    const chapterFile = this.chapterFile(projectKey, input.chapterId);
    const persisted: PersistedChapterChunks = {
      version: 1,
      chapterId: input.chapterId,
      title: input.title,
      contentHash,
      chunks
    };
    await this.files.writeJsonAtomic(chapterFile, persisted);

    index.chunksByChapter.set(input.chapterId, chunks);
    const now = new Date().toISOString();
    index.manifest.chapters[input.chapterId] = {
      chapterId: input.chapterId,
      title: input.title,
      volumeId: input.volumeId,
      volumeTitle: input.volumeTitle,
      chapterNumber: input.chapterNumber,
      contentHash,
      contentLength: content.length,
      chunkCount: chunks.length,
      chunkFile: path.relative(projectKey, chapterFile).replace(/\\/g, "/"),
      updatedAt: now
    };
    index.manifest = {
      ...index.manifest,
      generation: index.manifest.generation + 1,
      updatedAt: now,
      totalChunks: countChunks(index.chunksByChapter),
      embeddingProviderId: this.embeddingProvider.id,
      embeddingDimensions: this.embeddingProvider.dimensions ?? chunks[0]?.vector.length ?? hashVectorDimensions
    };
    await this.saveManifest(projectKey, index.manifest);
    return {
      chapterId: input.chapterId,
      changed: true,
      contentHash,
      chunks: chunks.slice(),
      indexedChunks: chunks.length,
      totalChunks: index.manifest.totalChunks,
      generation: index.manifest.generation
    };
  }

  /** Semantic alias used by import/update workflows. */
  async updateChapter(projectPath: string, input: IndexChapterInput): Promise<ChunkIndexUpdateResult>;
  async updateChapter(
    projectPath: string,
    chapterId: string,
    title: string,
    content: string,
    metadata?: Omit<IndexChapterInput, "chapterId" | "title" | "content" | "text">
  ): Promise<ChunkIndexUpdateResult>;
  async updateChapter(projectPath: string, chapterId: string, content: string): Promise<ChunkIndexUpdateResult>;
  async updateChapter(
    projectPath: string,
    inputOrChapterId: IndexChapterInput | string,
    ...args: unknown[]
  ): Promise<ChunkIndexUpdateResult> {
    if (typeof inputOrChapterId !== "string") {
      return this.indexChapter(projectPath, inputOrChapterId);
    }
    if (args.length >= 2) {
      return this.indexChapter(
        projectPath,
        inputOrChapterId,
        String(args[0] ?? inputOrChapterId),
        String(args[1] ?? ""),
        args[2] as Omit<IndexChapterInput, "chapterId" | "title" | "content" | "text"> | undefined
      );
    }
    return this.indexChapter(projectPath, inputOrChapterId, String(args[0] ?? ""));
  }

  /** Index a chapter by path; this is the only API that reads manuscript text. */
  async indexChapterFile(
    projectPath: string,
    input: Omit<IndexChapterInput, "content" | "text"> & { file: string }
  ): Promise<ChunkIndexUpdateResult> {
    const filePath = this.files.assertInsideProject(projectPath, input.file);
    const content = await this.files.readText(filePath);
    return this.indexChapter(projectPath, { ...input, content });
  }

  async indexChapters(projectPath: string, chapters: IndexChapterInput[]): Promise<ChunkIndexUpdateResult[]> {
    const results: ChunkIndexUpdateResult[] = [];
    for (const chapter of chapters) {
      results.push(await this.indexChapter(projectPath, chapter));
    }
    return results;
  }

  async removeChapter(projectPath: string, chapterId: string): Promise<boolean> {
    const projectKey = path.resolve(projectPath);
    const index = await this.ensureLoaded(projectKey);
    if (!index.manifest.chapters[chapterId]) {
      return false;
    }
    await rm(this.chapterFile(projectKey, chapterId), { force: true });
    index.chunksByChapter.delete(chapterId);
    const chapters = { ...index.manifest.chapters };
    delete chapters[chapterId];
    index.manifest = {
      ...index.manifest,
      chapters,
      generation: index.manifest.generation + 1,
      updatedAt: new Date().toISOString(),
      totalChunks: countChunks(index.chunksByChapter)
    };
    await this.saveManifest(projectKey, index.manifest);
    return true;
  }

  /** Return derived chunks; this never reads chapter source files. */
  async getChunks(projectPath: string, chapterIds?: readonly string[]): Promise<IndexedChunk[]> {
    const index = await this.ensureLoaded(path.resolve(projectPath));
    const allowed = chapterIds ? new Set(chapterIds) : undefined;
    const result: IndexedChunk[] = [];
    for (const [chapterId, chunks] of index.chunksByChapter) {
      if (!allowed || allowed.has(chapterId)) {
        result.push(...chunks);
      }
    }
    return result.slice();
  }

  async getChunk(projectPath: string, chunkId: string): Promise<IndexedChunk | undefined> {
    const chunks = await this.getChunks(projectPath);
    return chunks.find((chunk) => chunk.id === chunkId);
  }

  async getManifest(projectPath: string): Promise<ChunkIndexManifest> {
    const index = await this.ensureLoaded(path.resolve(projectPath));
    return structuredClone(index.manifest);
  }

  async getStats(projectPath: string): Promise<ChunkIndexStats> {
    const manifest = await this.getManifest(projectPath);
    return {
      generation: manifest.generation,
      chapters: Object.keys(manifest.chapters).length,
      chunks: manifest.totalChunks,
      embeddingProviderId: manifest.embeddingProviderId,
      embeddingDimensions: manifest.embeddingDimensions
    };
  }

  /** Clear only the in-process cache; persisted derived data is retained. */
  clearCache(projectPath?: string): void {
    if (projectPath) {
      this.loaded.delete(path.resolve(projectPath));
    } else {
      this.loaded.clear();
    }
  }

  private async ensureLoaded(projectPath: string): Promise<LoadedIndex> {
    const cached = this.loaded.get(projectPath);
    if (cached) {
      return cached;
    }
    let manifest: ChunkIndexManifest;
    try {
      manifest = await this.files.readJson<ChunkIndexManifest>(this.manifestPath(projectPath));
      validateManifest(manifest);
    } catch (error) {
      if (!isMissingFile(error)) {
        throw error;
      }
      manifest = emptyManifest(this.embeddingProvider);
    }
    const chunksByChapter = new Map<string, IndexedChunk[]>();
    const missingChapterIds: string[] = [];
    for (const [chapterId, metadata] of Object.entries(manifest.chapters)) {
      try {
        const persisted = await this.files.readJson<PersistedChapterChunks>(
          this.files.assertInsideProject(projectPath, metadata.chunkFile)
        );
        validatePersistedChapter(persisted, chapterId);
        chunksByChapter.set(chapterId, persisted.chunks);
      } catch (error) {
        if (isMissingFile(error)) {
          // A missing derived file is recoverable. Remove its metadata so stats
          // and unchanged-save detection cannot report phantom chunks.
          missingChapterIds.push(chapterId);
          continue;
        }
        throw error;
      }
    }
    if (missingChapterIds.length) {
      const chapters = { ...manifest.chapters };
      for (const chapterId of missingChapterIds) delete chapters[chapterId];
      manifest = {
        ...manifest,
        chapters,
        generation: manifest.generation + 1,
        updatedAt: new Date().toISOString(),
        totalChunks: countChunks(chunksByChapter)
      };
      await this.saveManifest(projectPath, manifest);
    }
    const loaded = { manifest, chunksByChapter };
    this.loaded.set(projectPath, loaded);
    return loaded;
  }

  private async saveManifest(projectPath: string, manifest: ChunkIndexManifest): Promise<void> {
    await this.files.writeJsonAtomic(this.manifestPath(projectPath), manifest);
  }

  private manifestPath(projectPath: string): string {
    return this.files.assertInsideProject(projectPath, path.posix.join(this.indexDirectory(), "manifest.json"));
  }

  private chapterFile(projectPath: string, chapterId: string): string {
    const fileName = `chapter-${safeFileId(chapterId)}-${hashText(chapterId).slice(0, 10)}.json`;
    return this.files.assertInsideProject(projectPath, path.posix.join(this.indexDirectory(), "chapters", fileName));
  }

  private indexDirectory(): string {
    return this.options.indexDirectory ?? path.posix.join(".inkforge", "continuation", "chunk-index");
  }
}

const normalizeChapterInput = (
  inputOrChapterId: IndexChapterInput | string,
  titleOrContent?: string,
  contentOrUndefined?: string,
  metadata?: Omit<IndexChapterInput, "chapterId" | "title" | "content" | "text">
): IndexChapterInput => {
  if (typeof inputOrChapterId !== "string") {
    const chapterId = inputOrChapterId.chapterId?.trim();
    if (!chapterId) {
      throw new Error("chapterId is required to index a chapter.");
    }
    return {
      ...inputOrChapterId,
      chapterId,
      title: inputOrChapterId.title?.trim() || chapterId,
      content: inputOrChapterId.content ?? inputOrChapterId.text ?? ""
    };
  }
  const chapterId = inputOrChapterId.trim();
  if (!chapterId) {
    throw new Error("chapterId is required to index a chapter.");
  }
  if (contentOrUndefined !== undefined) {
    return {
      ...metadata,
      chapterId,
      title: titleOrContent?.trim() || chapterId,
      content: contentOrUndefined
    };
  }
  return {
    ...metadata,
    chapterId,
    title: chapterId,
    content: titleOrContent ?? ""
  };
};

const createChunks = async (
  input: IndexChapterInput,
  content: string,
  chapterContentHash: string,
  options: Pick<ChunkIndexOptions, "targetCharacters" | "minCharacters" | "maxCharacters" | "overlapCharacters"> & {
    embeddingProvider?: EmbeddingProvider;
  }
): Promise<IndexedChunk[]> => {
  if (!content.length) {
    return [];
  }
  const ranges = splitRanges(content, options);
  const scenes = normalizeScenes(input.scenes, content.length);
  const provider = options.embeddingProvider ?? localHashEmbeddingProvider;
  const chunks: IndexedChunk[] = [];
  for (const [chunkIndex, range] of ranges.entries()) {
    const text = content.slice(range.startOffset, range.endOffset);
    const scene = sceneForRange(scenes, range.startOffset, range.endOffset);
    const vector = normalizeVector(await provider.embed(`${input.title}\n${text}`));
    chunks.push({
      id: `chunk-${safeFileId(input.chapterId)}-${String(chunkIndex).padStart(4, "0")}-${hashText(text).slice(0, 12)}`,
      chapterId: input.chapterId,
      chapterTitle: input.title,
      volumeId: input.volumeId,
      volumeTitle: input.volumeTitle,
      chapterNumber: input.chapterNumber,
      sceneId: scene?.id,
      sceneTitle: scene?.title,
      chunkIndex,
      startOffset: range.startOffset,
      endOffset: range.endOffset,
      text,
      contentHash: hashText(text),
      chapterContentHash,
      vector
    });
  }
  return chunks;
};

interface ChunkRange {
  startOffset: number;
  endOffset: number;
}

const splitRanges = (
  content: string,
  options: Pick<ChunkIndexOptions, "targetCharacters" | "minCharacters" | "maxCharacters" | "overlapCharacters">
): ChunkRange[] => {
  const target = options.targetCharacters ?? defaultTargetCharacters;
  const min = options.minCharacters ?? defaultMinCharacters;
  const max = options.maxCharacters ?? defaultMaxCharacters;
  const overlap = options.overlapCharacters ?? defaultOverlapCharacters;
  if (content.length <= max) {
    return [{ startOffset: 0, endOffset: content.length }];
  }

  // Prefer paragraph/sentence boundaries. Every max-sized window still has a
  // deterministic fallback, so an unusually long paragraph cannot loop.
  const breakpoints = collectBreakpoints(content);
  const ranges: ChunkRange[] = [];
  let start = 0;
  while (start < content.length) {
    if (content.length - start <= max) {
      ranges.push({ startOffset: start, endOffset: content.length });
      break;
    }
    const targetEnd = Math.min(content.length, start + target);
    const maxEnd = Math.min(content.length, start + max);
    // Avoid producing a tiny final sliver. When there is another chunk after
    // this one, leave enough room for a minimum-sized final chunk (taking the
    // configured overlap into account). This keeps ordinary chunks in the
    // requested 600–1200 character band without sacrificing overlap.
    const tailAwareMaxEnd = content.length - start > max ? Math.min(maxEnd, content.length - min + overlap) : maxEnd;
    const effectiveMaxEnd = tailAwareMaxEnd >= start + min ? tailAwareMaxEnd : maxEnd;
    const candidates = breakpoints.filter((point) => point >= start + min && point <= effectiveMaxEnd);
    let end = candidates.length
      ? candidates.reduce((best, point) => (Math.abs(point - targetEnd) < Math.abs(best - targetEnd) ? point : best))
      : effectiveMaxEnd;
    end = moveBoundaryToCodePoint(content, Math.max(start + 1, end));
    ranges.push({ startOffset: start, endOffset: end });
    const next = Math.max(start + 1, end - Math.min(overlap, Math.max(0, end - start - 1)));
    start = next;
  }
  return ranges;
};

const collectBreakpoints = (content: string): number[] => {
  const points = new Set<number>();
  const boundary = /\n\s*\n|[。！？!?；;](?:[”"』」）)】]*)?\s*/gu;
  for (const match of content.matchAll(boundary)) {
    const point = (match.index ?? 0) + match[0].length;
    if (point > 0 && point < content.length) {
      points.add(point);
    }
  }
  return [...points].sort((left, right) => left - right);
};

const moveBoundaryToCodePoint = (content: string, boundary: number): number => {
  let result = Math.min(content.length, Math.max(1, boundary));
  // Do not split a surrogate pair. Offsets remain UTF-16 offsets.
  if (result < content.length && result > 0) {
    const code = content.charCodeAt(result);
    if (code >= 0xdc00 && code <= 0xdfff) {
      result -= 1;
    }
  }
  return result;
};

const normalizeScenes = (scenes: ChunkSceneInput[] | undefined, contentLength: number): ChunkSceneInput[] =>
  (scenes ?? [])
    .filter((scene) => scene && scene.id && scene.endOffset > scene.startOffset)
    .map((scene) => ({
      ...scene,
      startOffset: Math.max(0, Math.min(contentLength, scene.startOffset)),
      endOffset: Math.max(0, Math.min(contentLength, scene.endOffset))
    }))
    .filter((scene) => scene.endOffset > scene.startOffset)
    .sort((left, right) => left.startOffset - right.startOffset);

const sceneForRange = (
  scenes: ChunkSceneInput[],
  startOffset: number,
  endOffset: number
): ChunkSceneInput | undefined => {
  let best: ChunkSceneInput | undefined;
  let bestOverlap = 0;
  for (const scene of scenes) {
    const overlap = Math.max(0, Math.min(endOffset, scene.endOffset) - Math.max(startOffset, scene.startOffset));
    if (overlap > bestOverlap) {
      best = scene;
      bestOverlap = overlap;
    }
  }
  return best;
};

const hashText = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

const safeFileId = (value: string): string => {
  const safe = value.replace(/[^a-zA-Z0-9_-]/gu, "_").slice(0, 80);
  return safe || "chapter";
};

const normalizeVector = (vector: readonly number[]): number[] => {
  const finite = [...vector].map((value) => (Number.isFinite(value) ? value : 0));
  const magnitude = Math.sqrt(finite.reduce((sum, value) => sum + value * value, 0));
  return magnitude ? finite.map((value) => value / magnitude) : finite;
};

const emptyManifest = (provider: EmbeddingProvider): ChunkIndexManifest => ({
  version: 1,
  generation: 0,
  updatedAt: new Date(0).toISOString(),
  embeddingProviderId: provider.id,
  embeddingDimensions: provider.dimensions ?? hashVectorDimensions,
  totalChunks: 0,
  chapters: {}
});

const countChunks = (chunksByChapter: Map<string, IndexedChunk[]>): number =>
  [...chunksByChapter.values()].reduce((sum, chunks) => sum + chunks.length, 0);

const validateManifest = (manifest: ChunkIndexManifest): void => {
  if (
    !manifest ||
    manifest.version !== 1 ||
    !manifest.chapters ||
    typeof manifest.generation !== "number" ||
    typeof manifest.totalChunks !== "number"
  ) {
    throw new Error("Invalid chunk index manifest.");
  }
};

const validatePersistedChapter = (persisted: PersistedChapterChunks, chapterId: string): void => {
  if (!persisted || persisted.version !== 1 || persisted.chapterId !== chapterId || !Array.isArray(persisted.chunks)) {
    throw new Error(`Invalid chunk index data for chapter ${chapterId}.`);
  }
};

const isMissingFile = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT";

export const CHUNK_INDEX_RELATIVE_DIRECTORY = path.posix.join(".inkforge", "continuation", "chunk-index");
