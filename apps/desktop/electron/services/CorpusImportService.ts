import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { FileRepository } from "./FileRepository.js";
import type {
  CorpusImportInput,
  CorpusImportManifest,
  CorpusSourceFile,
  DuplicateReason,
  EncodingDetection,
  ImportCheckpoint,
  ImportProgress,
  ImportedChapterRecord
} from "./ContinuationTypes.js";

const continuationRoot = ".inkforge/continuation";
const importDirectory = path.posix.join(continuationRoot, "imports");
const corpusDirectory = path.posix.join(continuationRoot, "corpus");
const probeSize = 64 * 1024;
const streamHighWaterMark = 64 * 1024;
const sourceExtensions = new Set([".txt", ".md", ".markdown"]);

type PauseControl = { pause: boolean; cancel: boolean };

interface ChapterAccumulator {
  title: string;
  lines: string[];
  startOffset: number;
  byteStart: number;
  chapterIndex: number;
}

interface ProcessContext {
  manifest: CorpusImportManifest;
  input: CorpusImportInput;
  sources: CorpusSourceFile[];
  completedFileBytes: number;
  existingByKey: Map<string, ImportedChapterRecord>;
  existingByHash: Map<string, ImportedChapterRecord>;
  existingByTitle: Map<string, ImportedChapterRecord>;
}

/**
 * Streams a manuscript into chapter files without ever putting the complete
 * corpus in renderer memory.  The manifest is written after every completed
 * chapter, so an interrupted process can safely replay only the current source
 * file and continue at the last complete chapter boundary.
 */
export class CorpusImportService {
  private readonly controls = new Map<string, PauseControl>();
  private readonly activeImports = new Set<string>();

  constructor(private readonly files = new FileRepository()) {}

  async detectEncoding(sourcePath: string): Promise<EncodingDetection> {
    const files = await collectSourceFiles(sourcePath);
    if (!files.length) {
      throw new Error("No .txt or .md source files were found.");
    }
    const sample = await readProbe(files[0].path);
    return detectEncoding(sample);
  }

  /** Alias used by callers that think in terms of importing a corpus. */
  async import(input: CorpusImportInput): Promise<CorpusImportManifest> {
    return this.start(input);
  }

  async start(input: CorpusImportInput): Promise<CorpusImportManifest> {
    if (!input.projectPath?.trim()) {
      throw new Error("A project path is required.");
    }
    if (!input.sourcePath?.trim() && !input.importId) {
      throw new Error("A manuscript source path is required.");
    }

    let manifest: CorpusImportManifest;
    if (input.importId) {
      manifest = await this.require(input.projectPath, input.importId);
      if (manifest.status === "completed") {
        return manifest;
      }
      if (manifest.status === "cancelled") {
        throw new Error("This import was cancelled and cannot be resumed; start a new import.");
      }
      if (input.sourcePath && path.resolve(input.sourcePath) !== path.resolve(manifest.sourcePath)) {
        throw new Error("The resume source path does not match the original import.");
      }
      input = { ...input, sourcePath: manifest.sourcePath, importId: manifest.id };
      await this.validateSources(manifest);
    } else {
      manifest = await this.createManifest(input);
    }

    if (this.activeImports.has(manifest.id)) {
      throw new Error(`Import ${manifest.id} is already running.`);
    }
    this.activeImports.add(manifest.id);
    const control = this.controls.get(manifest.id) ?? { pause: false, cancel: false };
    this.controls.set(manifest.id, control);

    try {
      manifest = updateManifest(manifest, { status: "running", error: undefined });
      await this.saveManifest(input.projectPath, manifest);
      const sources = manifest.sourceFiles;
      const context: ProcessContext = {
        manifest,
        input,
        sources,
        completedFileBytes: 0,
        existingByKey: new Map(manifest.chapters.map((chapter) => [chapter.key, chapter])),
        existingByHash: await this.loadExistingHashes(input.projectPath, manifest.id, manifest.chapters),
        existingByTitle: await this.loadExistingTitles(input.projectPath, manifest.id, manifest.chapters)
      };

      for (const source of sources) {
        if (control.cancel || control.pause) {
          break;
        }
        if (source.index < manifest.checkpoint.nextSourceIndex) {
          context.completedFileBytes += source.size;
          continue;
        }
        const processed = await this.processSourceFile(context, source, control);
        if (!processed.completed) {
          context.manifest.bytesRead = Math.max(
            context.manifest.bytesRead,
            Math.min(context.manifest.totalBytes, context.completedFileBytes + processed.bytesRead)
          );
          break;
        }
        context.completedFileBytes += source.size;
        manifest = context.manifest;
        manifest.checkpoint = checkpointForFile(
          manifest.checkpoint,
          source.index,
          source.size,
          context.completedFileBytes
        );
        manifest.bytesRead = Math.min(manifest.totalBytes, context.completedFileBytes);
        await this.saveManifest(input.projectPath, manifest);
      }

      manifest = context.manifest;
      if (control.cancel) {
        manifest = updateManifest(manifest, {
          status: "cancelled",
          bytesRead: Math.max(manifest.bytesRead, Math.min(manifest.totalBytes, context.completedFileBytes)),
          error: "Import cancelled by the author."
        });
      } else if (control.pause) {
        manifest = updateManifest(manifest, {
          status: "paused",
          bytesRead: Math.max(manifest.bytesRead, Math.min(manifest.totalBytes, context.completedFileBytes))
        });
      } else {
        manifest = updateManifest(manifest, {
          status: "completed",
          bytesRead: manifest.totalBytes,
          checkpoint: {
            ...manifest.checkpoint,
            nextSourceIndex: sources.length,
            bytesRead: manifest.totalBytes,
            updatedAt: new Date().toISOString()
          }
        });
      }
      context.manifest = manifest;
      await this.saveManifest(input.projectPath, manifest);
      await this.emitProgress(input.onProgress, manifest);
      return manifest;
    } catch (error) {
      const failed = updateManifest(manifest, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error)
      });
      await this.saveManifest(input.projectPath, failed).catch(() => undefined);
      throw error;
    } finally {
      this.activeImports.delete(manifest.id);
      if (control.cancel || control.pause || manifest.status === "completed" || manifest.status === "failed") {
        this.controls.delete(manifest.id);
      }
    }
  }

  async resume(
    projectPath: string,
    importId: string,
    onProgress?: CorpusImportInput["onProgress"]
  ): Promise<CorpusImportManifest> {
    const manifest = await this.require(projectPath, importId);
    if (manifest.status === "completed") {
      return manifest;
    }
    return this.start({ projectPath, sourcePath: manifest.sourcePath, importId, onProgress });
  }

  async pause(projectPath: string, importId: string): Promise<CorpusImportManifest> {
    const manifest = await this.require(projectPath, importId);
    if (!["pending", "running"].includes(manifest.status)) {
      return manifest;
    }
    const control = this.controls.get(importId) ?? { pause: false, cancel: false };
    control.pause = true;
    this.controls.set(importId, control);
    const paused = updateManifest(manifest, { status: "paused" });
    await this.saveManifest(projectPath, paused);
    return paused;
  }

  async cancel(projectPath: string, importId: string): Promise<CorpusImportManifest> {
    const manifest = await this.require(projectPath, importId);
    if (["completed", "cancelled"].includes(manifest.status)) {
      return manifest;
    }
    const control = this.controls.get(importId) ?? { pause: false, cancel: false };
    control.cancel = true;
    control.pause = false;
    this.controls.set(importId, control);
    const cancelled = updateManifest(manifest, { status: "cancelled", error: "Import cancelled by the author." });
    await this.saveManifest(projectPath, cancelled);
    return cancelled;
  }

  async get(projectPath: string, importId: string): Promise<CorpusImportManifest | undefined> {
    try {
      return await this.files.readJson<CorpusImportManifest>(this.manifestPath(projectPath, importId));
    } catch (error) {
      if (isMissingFile(error)) {
        return undefined;
      }
      throw error;
    }
  }

  async list(projectPath: string): Promise<CorpusImportManifest[]> {
    const directory = this.files.assertInsideProject(projectPath, importDirectory);
    let names: string[];
    try {
      names = (await readdir(directory, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => entry.name);
    } catch (error) {
      if (isMissingFile(error)) {
        return [];
      }
      throw error;
    }
    const manifests: CorpusImportManifest[] = [];
    for (const name of names) {
      try {
        manifests.push(await this.files.readJson<CorpusImportManifest>(path.join(directory, name)));
      } catch {
        // Ignore a half-written/foreign file; individual manifests are atomic.
      }
    }
    return manifests.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  private async createManifest(input: CorpusImportInput): Promise<CorpusImportManifest> {
    const sourcePath = path.resolve(input.sourcePath);
    const sourceFiles = await collectSourceFiles(sourcePath);
    if (!sourceFiles.length) {
      throw new Error("No .txt or .md source files were found.");
    }
    const sourceStat = await stat(sourcePath);
    const detection = input.encoding
      ? {
          encoding: input.encoding,
          confidence: 1,
          bom: undefined,
          sampleBytes: 0,
          reason: "Encoding selected by the caller."
        }
      : await this.detectEncoding(sourcePath);
    const now = new Date().toISOString();
    const id = input.importId?.trim() || randomUUID();
    const manifest: CorpusImportManifest = {
      schemaVersion: 1,
      id,
      projectPath: path.resolve(input.projectPath),
      sourcePath,
      sourceType: sourceStat.isDirectory() ? "directory" : "file",
      sourceFiles,
      encoding: detection.encoding,
      encodingConfidence: detection.confidence,
      status: "pending",
      totalBytes: sourceFiles.reduce((total, source) => total + source.size, 0),
      bytesRead: 0,
      chapters: [],
      duplicateChapterIds: [],
      checkpoint: {
        sourceIndex: -1,
        chapterIndex: -1,
        nextSourceIndex: 0,
        bytesRead: 0,
        updatedAt: now
      },
      createdAt: now,
      updatedAt: now
    };
    await this.saveManifest(input.projectPath, manifest);
    return manifest;
  }

  private async processSourceFile(
    context: ProcessContext,
    source: CorpusSourceFile,
    control: PauseControl
  ): Promise<{ bytesRead: number; completed: boolean }> {
    const { input } = context;
    const heading = compileHeading(input.headingPattern);
    const detection = await this.detectEncoding(source.path);
    // A directory may contain files saved in different legacy encodings.  A
    // caller override wins; otherwise detect each file independently instead
    // of blindly applying the first file's manifest encoding to all files.
    const encoding = input.encoding ?? detection.encoding;
    const decoder = new TextDecoder(encoding, { fatal: false });
    const stream = createReadStream(source.path, { highWaterMark: streamHighWaterMark });
    let pending = "";
    let firstChunk = true;
    let sourceBytesRead = 0;
    let decodedOffset = 0;
    let accumulator: ChapterAccumulator | undefined;
    let chapterIndex = 0;

    const consumeLine = async (rawLine: string, approximateByteOffset: number): Promise<void> => {
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      const lineStart = decodedOffset;
      decodedOffset += rawLine.length + 1;
      const title = extractHeadingTitle(line, heading);
      if (title !== undefined) {
        if (accumulator && accumulator.lines.some((part) => part.trim())) {
          await this.commitChapter(context, source, accumulator, sourceBytesRead, control);
          chapterIndex += 1;
        }
        accumulator = {
          title: title || `Chapter ${chapterIndex + 1}`,
          lines: [line],
          startOffset: lineStart,
          byteStart: approximateByteOffset,
          chapterIndex
        };
        return;
      }
      if (!accumulator) {
        accumulator = {
          title: basenameTitle(source.path),
          lines: [],
          startOffset: lineStart,
          byteStart: approximateByteOffset,
          chapterIndex
        };
      }
      accumulator.lines.push(line);
    };

    try {
      for await (const chunk of stream) {
        if (control.cancel || control.pause) {
          stream.destroy();
          break;
        }
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        sourceBytesRead += bytes.byteLength;
        let data = bytes;
        if (firstChunk) {
          firstChunk = false;
          if (encoding === "utf8" && startsWithUtf8Bom(data)) {
            data = data.subarray(3);
          }
        }
        pending += decoder.decode(data, { stream: true });
        let newlineIndex = pending.indexOf("\n");
        while (newlineIndex >= 0) {
          const line = pending.slice(0, newlineIndex);
          pending = pending.slice(newlineIndex + 1);
          await consumeLine(line, sourceBytesRead);
          newlineIndex = pending.indexOf("\n");
          if (control.cancel || control.pause) {
            break;
          }
        }
      }
      if (!control.cancel && !control.pause) {
        pending += decoder.decode();
        if (pending.length) {
          await consumeLine(pending, sourceBytesRead);
        }
        if (accumulator && accumulator.lines.some((part) => part.trim())) {
          await this.commitChapter(context, source, accumulator, sourceBytesRead, control);
        }
      }
    } finally {
      stream.destroy();
    }
    return { bytesRead: sourceBytesRead, completed: !control.cancel && !control.pause };
  }

  private async commitChapter(
    context: ProcessContext,
    source: CorpusSourceFile,
    accumulator: ChapterAccumulator,
    sourceBytesRead: number,
    control: PauseControl
  ): Promise<void> {
    if (control.cancel || control.pause) {
      return;
    }
    const { manifest, input } = context;
    const content = accumulator.lines.join("\n").trimEnd() + "\n";
    if (!content.trim()) {
      return;
    }
    const contentHash = sha256(content);
    const key = `${source.index}:${accumulator.chapterIndex}`;
    const existing = context.existingByKey.get(key);
    if (existing && existing.contentHash === contentHash) {
      manifest.checkpoint = checkpointAfterChapter(
        manifest.checkpoint,
        source.index,
        accumulator.chapterIndex,
        existing.id,
        sourceBytesRead
      );
      manifest.bytesRead = Math.min(manifest.totalBytes, context.completedFileBytes + sourceBytesRead);
      await this.saveManifest(input.projectPath, manifest);
      await this.emitProgress(input.onProgress, manifest, source.path, existing.title);
      return;
    }

    const ordinal = manifest.chapters.length;
    const chapterId = `${manifest.id}-ch-${String(ordinal + 1).padStart(5, "0")}`;
    const contentPath = path.posix.join(
      corpusDirectory,
      safeId(manifest.id),
      "chapters",
      `ch-${String(ordinal + 1).padStart(5, "0")}.md`
    );
    await this.files.writeTextAtomic(this.files.assertInsideProject(input.projectPath, contentPath), content);

    const duplicate = findDuplicate(context, contentHash, normalizeTitle(accumulator.title));
    const record: ImportedChapterRecord = {
      id: chapterId,
      key,
      ordinal,
      title: accumulator.title,
      sourcePath: source.path,
      sourceIndex: source.index,
      chapterIndex: accumulator.chapterIndex,
      contentPath,
      startOffset: accumulator.startOffset,
      endOffset: accumulator.startOffset + content.length,
      byteStart: accumulator.byteStart,
      byteEnd: sourceBytesRead,
      contentHash,
      charCount: content.length,
      wordCount: countWords(content),
      status: duplicate ? "duplicate" : "imported",
      duplicateOf: duplicate?.chapter.id,
      duplicateReason: duplicate?.reason,
      importedAt: new Date().toISOString()
    };
    manifest.chapters.push(record);
    context.existingByKey.set(key, record);
    context.existingByHash.set(contentHash, record);
    context.existingByTitle.set(normalizeTitle(accumulator.title), record);
    if (duplicate && !manifest.duplicateChapterIds.includes(record.id)) {
      manifest.duplicateChapterIds.push(record.id);
    }
    manifest.checkpoint = checkpointAfterChapter(
      manifest.checkpoint,
      source.index,
      accumulator.chapterIndex,
      record.id,
      sourceBytesRead
    );
    manifest.bytesRead = Math.min(manifest.totalBytes, context.completedFileBytes + sourceBytesRead);
    await this.saveManifest(input.projectPath, manifest);
    await this.emitProgress(input.onProgress, manifest, source.path, record.title);
  }

  private async loadExistingHashes(
    projectPath: string,
    currentImportId: string,
    current: ImportedChapterRecord[]
  ): Promise<Map<string, ImportedChapterRecord>> {
    const map = new Map<string, ImportedChapterRecord>(current.map((chapter) => [chapter.contentHash, chapter]));
    for (const manifest of await this.list(projectPath)) {
      if (manifest.id === currentImportId) {
        continue;
      }
      for (const chapter of manifest.chapters) {
        if (!map.has(chapter.contentHash)) {
          map.set(chapter.contentHash, chapter);
        }
      }
    }
    return map;
  }

  private async loadExistingTitles(
    projectPath: string,
    currentImportId: string,
    current: ImportedChapterRecord[]
  ): Promise<Map<string, ImportedChapterRecord>> {
    const map = new Map<string, ImportedChapterRecord>(
      current.map((chapter) => [normalizeTitle(chapter.title), chapter])
    );
    for (const manifest of await this.list(projectPath)) {
      if (manifest.id === currentImportId) {
        continue;
      }
      for (const chapter of manifest.chapters) {
        const key = normalizeTitle(chapter.title);
        if (key && !map.has(key)) {
          map.set(key, chapter);
        }
      }
    }
    return map;
  }

  private async validateSources(manifest: CorpusImportManifest): Promise<void> {
    for (const source of manifest.sourceFiles) {
      const metadata = await stat(source.path);
      if (metadata.size !== source.size || metadata.mtime.toISOString() !== source.modifiedAt) {
        throw new Error(`Source file changed after import started: ${source.path}`);
      }
    }
  }

  private async require(projectPath: string, importId: string): Promise<CorpusImportManifest> {
    const manifest = await this.get(projectPath, importId);
    if (!manifest) {
      throw new Error(`Import not found: ${importId}`);
    }
    return manifest;
  }

  private async saveManifest(projectPath: string, manifest: CorpusImportManifest): Promise<void> {
    await this.files.writeJsonAtomic(this.manifestPath(projectPath, manifest.id), updateManifest(manifest, {}));
  }

  private manifestPath(projectPath: string, importId: string): string {
    return this.files.assertInsideProject(projectPath, path.posix.join(importDirectory, `${safeId(importId)}.json`));
  }

  private async emitProgress(
    handler: CorpusImportInput["onProgress"],
    manifest: CorpusImportManifest,
    currentSourcePath?: string,
    currentChapterTitle?: string
  ): Promise<void> {
    if (!handler) {
      return;
    }
    const progress: ImportProgress = {
      importId: manifest.id,
      status: manifest.status,
      bytesRead: manifest.bytesRead,
      totalBytes: manifest.totalBytes,
      completedChapters: manifest.chapters.length,
      currentSourcePath,
      currentChapterTitle,
      checkpoint: manifest.checkpoint
    };
    await handler(progress);
  }
}

export const detectEncoding = (sample: Uint8Array): EncodingDetection => {
  const bom = startsWithUtf8Bom(sample) ? "utf8" : undefined;
  const bytes = bom ? sample.subarray(3) : sample;
  if (!bytes.byteLength) {
    return { encoding: "utf8", confidence: 0.5, bom, sampleBytes: sample.byteLength, reason: "The source is empty." };
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return {
      encoding: "utf8",
      confidence: bom ? 1 : 0.99,
      bom,
      sampleBytes: sample.byteLength,
      reason: bom ? "Detected a UTF-8 BOM." : "The probe is valid UTF-8."
    };
  } catch {
    return {
      encoding: "gb18030",
      confidence: 0.78,
      bom,
      sampleBytes: sample.byteLength,
      reason: "The UTF-8 probe is invalid; GB18030 fallback selected."
    };
  }
};

const readProbe = async (sourcePath: string): Promise<Buffer> => {
  const stream = createReadStream(sourcePath, { start: 0, end: probeSize - 1 });
  const chunks: Buffer[] = [];
  let length = 0;
  try {
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      chunks.push(buffer);
      length += buffer.length;
      if (length >= probeSize) {
        break;
      }
    }
  } finally {
    stream.destroy();
  }
  return Buffer.concat(chunks, length);
};

const collectSourceFiles = async (sourcePath: string): Promise<CorpusSourceFile[]> => {
  const resolved = path.resolve(sourcePath);
  const metadata = await stat(resolved);
  const paths: string[] = [];
  if (metadata.isDirectory()) {
    await walkSourceDirectory(resolved, paths);
  } else if (isSupportedSource(resolved)) {
    paths.push(resolved);
  }
  paths.sort((left, right) => left.localeCompare(right, "zh-CN"));
  const result: CorpusSourceFile[] = [];
  for (let index = 0; index < paths.length; index += 1) {
    const item = await stat(paths[index]);
    result.push({ index, path: paths[index], size: item.size, modifiedAt: item.mtime.toISOString() });
  }
  return result;
};

const walkSourceDirectory = async (directory: string, output: string[]): Promise<void> => {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, "zh-CN"))) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") {
      continue;
    }
    const item = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walkSourceDirectory(item, output);
    } else if (entry.isFile() && isSupportedSource(item)) {
      output.push(item);
    }
  }
};

const isSupportedSource = (sourcePath: string): boolean => sourceExtensions.has(path.extname(sourcePath).toLowerCase());

const compileHeading = (pattern?: string): RegExp => {
  if (pattern?.trim()) {
    return new RegExp(pattern, "u");
  }
  return /^(?:#{1,6}\s+(.+?)|第[0-9０-９一二三四五六七八九十百千万两零〇]+章\s*(.*)|Chapter\s+\d+\s*(.*))\s*$/iu;
};

const extractHeadingTitle = (line: string, pattern: RegExp): string | undefined => {
  const match = pattern.exec(line);
  if (!match) {
    return undefined;
  }
  const capture = match.slice(1).find((item) => item !== undefined && item.trim());
  return (capture ?? line.replace(/^#+\s*/u, "")).trim();
};

const checkpointAfterChapter = (
  checkpoint: ImportCheckpoint,
  sourceIndex: number,
  chapterIndex: number,
  chapterId: string,
  bytesRead: number
): ImportCheckpoint => ({
  ...checkpoint,
  sourceIndex,
  chapterIndex,
  nextSourceIndex: Math.min(checkpoint.nextSourceIndex, sourceIndex),
  bytesRead,
  lastChapterId: chapterId,
  updatedAt: new Date().toISOString()
});

const checkpointForFile = (
  checkpoint: ImportCheckpoint,
  sourceIndex: number,
  sourceSize: number,
  totalBytesRead: number
): ImportCheckpoint => ({
  ...checkpoint,
  sourceIndex,
  chapterIndex: checkpoint.sourceIndex === sourceIndex ? checkpoint.chapterIndex : -1,
  nextSourceIndex: sourceIndex + 1,
  bytesRead: Math.max(totalBytesRead, sourceSize),
  updatedAt: new Date().toISOString()
});

const updateManifest = (
  manifest: CorpusImportManifest,
  patch: Partial<CorpusImportManifest>
): CorpusImportManifest => ({
  ...manifest,
  ...patch,
  updatedAt: new Date().toISOString()
});

const findDuplicate = (
  context: ProcessContext,
  contentHash: string,
  normalizedTitle: string
): { chapter: ImportedChapterRecord; reason: DuplicateReason } | undefined => {
  const byHash = context.existingByHash.get(contentHash);
  if (byHash) {
    return { chapter: byHash, reason: "hash" };
  }
  if (!normalizedTitle) {
    return undefined;
  }
  const exactTitle = context.existingByTitle.get(normalizedTitle);
  if (exactTitle) {
    return { chapter: exactTitle, reason: "title" };
  }
  // Titles are a warning rather than a merge key.  Prefix/containment with a
  // reasonable length ratio catches common edits such as “（修订）” while
  // leaving unrelated short titles alone.
  for (const [candidateTitle, chapter] of context.existingByTitle) {
    const shorter = Math.min(candidateTitle.length, normalizedTitle.length);
    const longer = Math.max(candidateTitle.length, normalizedTitle.length);
    if (
      shorter >= 4 &&
      shorter / longer >= 0.7 &&
      (candidateTitle.includes(normalizedTitle) || normalizedTitle.includes(candidateTitle))
    ) {
      return { chapter, reason: "title" };
    }
  }
  return undefined;
};

const normalizeTitle = (value: string): string => value.toLocaleLowerCase("zh-CN").replace(/[\s\p{P}\p{S}]+/gu, "");

const basenameTitle = (sourcePath: string): string =>
  path.basename(sourcePath, path.extname(sourcePath)) || "Imported chapter";

const countWords = (value: string): number => value.replace(/\s/gu, "").length;

const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

const startsWithUtf8Bom = (value: Uint8Array): boolean =>
  value.length >= 3 && value[0] === 0xef && value[1] === 0xbb && value[2] === 0xbf;

const safeId = (value: string): string => value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "import";

const isMissingFile = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT";
