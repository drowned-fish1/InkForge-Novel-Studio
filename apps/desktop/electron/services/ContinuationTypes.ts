/**
 * Types shared by the long-novel import and analysis services.
 *
 * These are intentionally kept in the Electron service layer for now.  The
 * continuation schema package can adopt/bridge them when the IPC surface is
 * wired up; keeping the persistence shape here means importing a manuscript
 * never depends on renderer state or an AI provider.
 */

export type CorpusEncoding = "utf8" | "gb18030";

export type ImportStatus = "pending" | "running" | "paused" | "completed" | "cancelled" | "failed";

export interface EncodingDetection {
  encoding: CorpusEncoding;
  confidence: number;
  bom: "utf8" | undefined;
  sampleBytes: number;
  reason: string;
}

export interface CorpusSourceFile {
  index: number;
  path: string;
  size: number;
  modifiedAt: string;
}

export interface ImportCheckpoint {
  /** Source file currently being processed. */
  sourceIndex: number;
  /** Last complete chapter index in sourceIndex, or -1 when no chapter exists. */
  chapterIndex: number;
  /** Next source file that still needs to be scanned after a clean file boundary. */
  nextSourceIndex: number;
  bytesRead: number;
  lastChapterId?: string;
  updatedAt: string;
}

export type DuplicateReason = "hash" | "title";

export interface ImportedChapterRecord {
  id: string;
  /** Stable key within an import, e.g. `source-0:chapter-2`. */
  key: string;
  ordinal: number;
  title: string;
  sourcePath: string;
  sourceIndex: number;
  chapterIndex: number;
  contentPath: string;
  startOffset: number;
  endOffset: number;
  /** Byte offsets are intentionally approximate around decoder boundaries. */
  byteStart: number;
  byteEnd: number;
  contentHash: string;
  charCount: number;
  wordCount: number;
  status: "imported" | "duplicate";
  duplicateOf?: string;
  duplicateReason?: DuplicateReason;
  importedAt: string;
}

export interface CorpusImportManifest {
  schemaVersion: 1;
  id: string;
  projectPath: string;
  sourcePath: string;
  sourceType: "file" | "directory";
  sourceFiles: CorpusSourceFile[];
  encoding: CorpusEncoding;
  encodingConfidence: number;
  status: ImportStatus;
  totalBytes: number;
  bytesRead: number;
  chapters: ImportedChapterRecord[];
  duplicateChapterIds: string[];
  checkpoint: ImportCheckpoint;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

export interface ImportProgress {
  importId: string;
  status: ImportStatus;
  bytesRead: number;
  totalBytes: number;
  completedChapters: number;
  currentSourcePath?: string;
  currentChapterTitle?: string;
  checkpoint: ImportCheckpoint;
}

export interface CorpusImportInput {
  projectPath: string;
  sourcePath: string;
  importId?: string;
  encoding?: CorpusEncoding;
  /** Optional custom line heading regex. Capture group 1 is used as title. */
  headingPattern?: string;
  onProgress?: (progress: ImportProgress) => void | Promise<void>;
}

export type AnalysisTaskStatus = "queued" | "running" | "completed" | "skipped" | "failed" | "cancelled";

export interface AnalysisCheckpoint {
  taskIndex: number;
  lastChapterId?: string;
  updatedAt: string;
}

export interface AnalysisJobTask {
  id: string;
  chapterId: string;
  chapterTitle: string;
  contentHash: string;
  status: AnalysisTaskStatus;
  analysisPath?: string;
  reused?: boolean;
  error?: string;
}

export interface AnalysisJob {
  schemaVersion: 1;
  id: string;
  projectPath: string;
  importId: string;
  status: ImportStatus;
  tasks: AnalysisJobTask[];
  completedTasks: number;
  checkpoint: AnalysisCheckpoint;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

export interface AnalysisProgress {
  jobId: string;
  status: ImportStatus;
  completedTasks: number;
  totalTasks: number;
  currentChapterId?: string;
  checkpoint: AnalysisCheckpoint;
}

export interface AnalysisJobInput {
  projectPath: string;
  importId: string;
  jobId?: string;
  chapterIds?: string[];
  force?: boolean;
  onProgress?: (progress: AnalysisProgress) => void | Promise<void>;
}

export interface SceneCandidate {
  id: string;
  startOffset: number;
  endOffset: number;
  excerpt: string;
  contentHash: string;
}

export interface EntityCandidate {
  value: string;
  kind: "quoted" | "term";
  evidenceStart: number;
  evidenceEnd: number;
}

export interface ChapterAnalysis {
  schemaVersion: 1;
  chapterId: string;
  chapterTitle: string;
  contentHash: string;
  generatedAt: string;
  summary: string;
  sceneCandidates: SceneCandidate[];
  entityCandidates: EntityCandidate[];
  stats: {
    charCount: number;
    wordCount: number;
    paragraphCount: number;
    sentenceCount: number;
    averageSentenceLength: number;
    dialogueRatio: number;
  };
}
