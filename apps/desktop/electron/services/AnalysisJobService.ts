import { createHash, randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { FileRepository } from "./FileRepository.js";
import { CorpusImportService } from "./CorpusImportService.js";
import type {
  AnalysisJob,
  AnalysisJobInput,
  AnalysisJobTask,
  AnalysisProgress,
  ChapterAnalysis,
  EntityCandidate,
  ImportedChapterRecord,
  SceneCandidate
} from "./ContinuationTypes.js";

const continuationRoot = ".inkforge/continuation";
const jobsDirectory = path.posix.join(continuationRoot, "jobs");
const analysisDirectory = path.posix.join(continuationRoot, "analysis");

type PauseControl = { pause: boolean; cancel: boolean };

export type ChapterAnalyzer = (
  chapter: ImportedChapterRecord,
  content: string
) => Promise<ChapterAnalysis> | ChapterAnalysis;

/**
 * Durable, chapter-at-a-time preprocessing jobs.  The default analyzer is
 * deliberately deterministic and local-only; an AI extractor can be injected
 * later without changing checkpointing or persistence semantics.
 */
export class AnalysisJobService {
  private readonly controls = new Map<string, PauseControl>();
  private readonly activeJobs = new Set<string>();

  constructor(
    private readonly files = new FileRepository(),
    private readonly imports = new CorpusImportService(files),
    private readonly analyzer: ChapterAnalyzer = defaultChapterAnalyzer
  ) {}

  async create(input: AnalysisJobInput): Promise<AnalysisJob> {
    const manifest = await this.imports.get(input.projectPath, input.importId);
    if (!manifest) {
      throw new Error(`Import not found: ${input.importId}`);
    }
    if (!manifest.chapters.length) {
      throw new Error("The import contains no completed chapters.");
    }
    const selected = input.chapterIds?.length
      ? input.chapterIds.map((id) => {
          const chapter = manifest.chapters.find((item) => item.id === id);
          if (!chapter) {
            throw new Error(`Chapter not found in import: ${id}`);
          }
          return chapter;
        })
      : manifest.chapters;
    const now = new Date().toISOString();
    const tasks: AnalysisJobTask[] = selected.map((chapter) => ({
      id: randomUUID(),
      chapterId: chapter.id,
      chapterTitle: chapter.title,
      contentHash: chapter.contentHash,
      status: "queued"
    }));
    const job: AnalysisJob = {
      schemaVersion: 1,
      id: input.jobId?.trim() || randomUUID(),
      projectPath: path.resolve(input.projectPath),
      importId: input.importId,
      status: "pending",
      tasks,
      completedTasks: 0,
      checkpoint: { taskIndex: -1, updatedAt: now },
      createdAt: now,
      updatedAt: now
    };
    await this.save(job);
    return job;
  }

  async start(input: AnalysisJobInput): Promise<AnalysisJob> {
    let job = input.jobId ? await this.require(input.projectPath, input.jobId) : await this.create(input);
    const force = Boolean(input.force);
    if (job.status === "completed" && !force) {
      const reusable = await Promise.all(
        job.tasks.map((task) =>
          task.analysisPath
            ? this.isReusable(job.projectPath, task.analysisPath, task.contentHash)
            : Promise.resolve(false)
        )
      );
      if (reusable.every(Boolean)) return job;
      job = updateJob(job, {
        status: "pending",
        completedTasks: reusable.filter(Boolean).length,
        tasks: job.tasks.map((task, index) =>
          reusable[index]
            ? task
            : { ...task, status: "queued" as const, reused: false, analysisPath: undefined, error: undefined }
        )
      });
    }
    if (force) {
      job = updateJob(job, {
        status: "pending",
        completedTasks: 0,
        tasks: job.tasks.map((task) => ({
          ...task,
          status: "queued" as const,
          reused: false,
          analysisPath: undefined,
          error: undefined
        }))
      });
    }
    if (job.status === "cancelled") {
      throw new Error("This analysis job was cancelled and cannot be resumed.");
    }
    if (this.activeJobs.has(job.id)) {
      throw new Error(`Analysis job ${job.id} is already running.`);
    }
    this.activeJobs.add(job.id);
    const control = this.controls.get(job.id) ?? { pause: false, cancel: false };
    this.controls.set(job.id, control);
    try {
      job = updateJob(job, { status: "running", error: undefined });
      await this.save(job);
      const manifest = await this.imports.get(input.projectPath, job.importId);
      if (!manifest) {
        throw new Error(`Import not found: ${job.importId}`);
      }
      const chapters = new Map(manifest.chapters.map((chapter) => [chapter.id, chapter]));
      for (let index = 0; index < job.tasks.length; index += 1) {
        if (control.cancel || control.pause) {
          break;
        }
        const task = job.tasks[index];
        if (task.status === "completed" || task.status === "skipped") {
          if (task.analysisPath && (await this.isReusable(job.projectPath, task.analysisPath, task.contentHash))) {
            continue;
          }
          job = updateTask(job, task.id, {
            status: "queued",
            reused: false,
            analysisPath: undefined,
            error: undefined
          });
        }
        const chapter = chapters.get(task.chapterId);
        if (!chapter) {
          job = updateTask(job, task.id, { status: "failed", error: "Chapter is no longer present in the import." });
          await this.save(job);
          continue;
        }
        const analysisPath = this.analysisPath(job.projectPath, job.importId, chapter.id);
        if (!force && (await this.isReusable(job.projectPath, analysisPath, task.contentHash))) {
          job = updateTask(job, task.id, {
            status: "skipped",
            reused: true,
            analysisPath,
            error: undefined
          });
          job = updateJob(job, {
            completedTasks: countCompleted(job.tasks),
            checkpoint: {
              taskIndex: index,
              lastChapterId: chapter.id,
              updatedAt: new Date().toISOString()
            }
          });
          await this.save(job);
          await this.emitProgress(input.onProgress, job, chapter.id);
          continue;
        }

        const content = await this.files.readText(this.files.assertInsideProject(job.projectPath, chapter.contentPath));
        if (sha256(content) !== task.contentHash) {
          job = updateTask(job, task.id, {
            status: "failed",
            error: "Chapter content changed after import; re-import before analyzing."
          });
          job = updateJob(job, {
            completedTasks: countCompleted(job.tasks),
            checkpoint: checkpointAt(index, chapter.id)
          });
          await this.save(job);
          continue;
        }
        job = updateTask(job, task.id, { status: "running", error: undefined });
        await this.save(job);
        try {
          const result = await this.analyzer(chapter, content);
          if (control.cancel) {
            break;
          }
          if (result.chapterId !== chapter.id || result.contentHash !== task.contentHash) {
            throw new Error("Analyzer returned an invalid chapter id or content hash.");
          }
          await this.files.writeJsonAtomic(this.files.assertInsideProject(job.projectPath, analysisPath), result);
          job = updateTask(job, task.id, { status: "completed", analysisPath, error: undefined });
          job = updateJob(job, {
            completedTasks: countCompleted(job.tasks),
            checkpoint: checkpointAt(index, chapter.id)
          });
          await this.save(job);
          await this.emitProgress(input.onProgress, job, chapter.id);
        } catch (error) {
          job = updateTask(job, task.id, {
            status: "failed",
            error: error instanceof Error ? error.message : String(error)
          });
          job = updateJob(job, {
            completedTasks: countCompleted(job.tasks),
            checkpoint: checkpointAt(index, chapter.id)
          });
          await this.save(job);
        }
      }

      if (control.cancel) {
        job = updateJob(job, {
          status: "cancelled",
          completedTasks: countCompleted(job.tasks),
          error: "Analysis job cancelled by the author."
        });
        job = cancelPendingTasks(job);
      } else if (control.pause) {
        job = updateJob(job, { status: "paused", completedTasks: countCompleted(job.tasks) });
      } else if (job.tasks.every((task) => task.status === "completed" || task.status === "skipped")) {
        job = updateJob(job, { status: "completed", completedTasks: job.tasks.length });
      } else if (job.tasks.some((task) => task.status === "failed")) {
        // Failed chapters stay retryable; the job is paused so a user can
        // inspect the chapter error before asking to resume.
        job = updateJob(job, { status: "paused", completedTasks: countCompleted(job.tasks) });
      } else {
        job = updateJob(job, { status: "paused", completedTasks: countCompleted(job.tasks) });
      }
      await this.save(job);
      await this.emitProgress(input.onProgress, job);
      return job;
    } catch (error) {
      const failed = updateJob(job, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error)
      });
      await this.save(failed).catch(() => undefined);
      throw error;
    } finally {
      this.activeJobs.delete(job.id);
      if (control.cancel || control.pause || job.status === "completed" || job.status === "failed") {
        this.controls.delete(job.id);
      }
    }
  }

  async resume(projectPath: string, jobId: string, onProgress?: AnalysisJobInput["onProgress"]): Promise<AnalysisJob> {
    const job = await this.require(projectPath, jobId);
    if (job.status === "completed") {
      return job;
    }
    return this.start({ projectPath, importId: job.importId, jobId, onProgress });
  }

  async pause(projectPath: string, jobId: string): Promise<AnalysisJob> {
    const job = await this.require(projectPath, jobId);
    if (!["pending", "running"].includes(job.status)) {
      return job;
    }
    const control = this.controls.get(jobId) ?? { pause: false, cancel: false };
    control.pause = true;
    this.controls.set(jobId, control);
    const paused = updateJob(job, { status: "paused" });
    await this.save(paused);
    return paused;
  }

  async cancel(projectPath: string, jobId: string): Promise<AnalysisJob> {
    const job = await this.require(projectPath, jobId);
    if (["completed", "cancelled"].includes(job.status)) {
      return job;
    }
    const control = this.controls.get(jobId) ?? { pause: false, cancel: false };
    control.cancel = true;
    control.pause = false;
    this.controls.set(jobId, control);
    const cancelled = cancelPendingTasks(
      updateJob(job, { status: "cancelled", error: "Analysis job cancelled by the author." })
    );
    await this.save(cancelled);
    return cancelled;
  }

  async get(projectPath: string, jobId: string): Promise<AnalysisJob | undefined> {
    try {
      return await this.files.readJson<AnalysisJob>(this.jobPath(projectPath, jobId));
    } catch (error) {
      if (isMissingFile(error)) {
        return undefined;
      }
      throw error;
    }
  }

  async list(projectPath: string): Promise<AnalysisJob[]> {
    const directory = this.files.assertInsideProject(projectPath, jobsDirectory);
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (isMissingFile(error)) {
        return [];
      }
      throw error;
    }
    const jobs: AnalysisJob[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }
      try {
        jobs.push(await this.files.readJson<AnalysisJob>(path.join(directory, entry.name)));
      } catch {
        // Ignore unrelated/corrupt files so one bad report does not hide all jobs.
      }
    }
    return jobs.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async readAnalysis(
    projectPath: string,
    job: AnalysisJob,
    task: AnalysisJobTask
  ): Promise<ChapterAnalysis | undefined> {
    if (!task.analysisPath) {
      return undefined;
    }
    try {
      return await this.files.readJson<ChapterAnalysis>(this.files.assertInsideProject(projectPath, task.analysisPath));
    } catch (error) {
      if (isMissingFile(error)) {
        return undefined;
      }
      throw error;
    }
  }

  private async isReusable(projectPath: string, analysisPath: string, contentHash: string): Promise<boolean> {
    try {
      const value = await this.files.readJson<ChapterAnalysis>(
        this.files.assertInsideProject(projectPath, analysisPath)
      );
      return isChapterAnalysis(value) && value.contentHash === contentHash;
    } catch {
      return false;
    }
  }

  private async require(projectPath: string, jobId: string): Promise<AnalysisJob> {
    const job = await this.get(projectPath, jobId);
    if (!job) {
      throw new Error(`Analysis job not found: ${jobId}`);
    }
    return job;
  }

  private async save(job: AnalysisJob): Promise<void> {
    await this.files.writeJsonAtomic(this.jobPath(job.projectPath, job.id), updateJob(job, {}));
  }

  private jobPath(projectPath: string, jobId: string): string {
    return this.files.assertInsideProject(projectPath, path.posix.join(jobsDirectory, `${safeId(jobId)}.json`));
  }

  private analysisPath(projectPath: string, importId: string, chapterId: string): string {
    // The returned value is relative to projectPath, making reports portable
    // with a project backup while still being protected by assertInsideProject.
    void projectPath;
    return path.posix.join(analysisDirectory, safeId(importId), `${safeId(chapterId)}.json`);
  }

  private async emitProgress(
    handler: AnalysisJobInput["onProgress"],
    job: AnalysisJob,
    currentChapterId?: string
  ): Promise<void> {
    if (!handler) {
      return;
    }
    const progress: AnalysisProgress = {
      jobId: job.id,
      status: job.status,
      completedTasks: job.completedTasks,
      totalTasks: job.tasks.length,
      currentChapterId,
      checkpoint: job.checkpoint
    };
    await handler(progress);
  }
}

export const defaultChapterAnalyzer: ChapterAnalyzer = (chapter, content): ChapterAnalysis => {
  const paragraphs = splitParagraphs(content);
  const summary = (paragraphs.find((paragraph) => !/^#{1,6}\s/u.test(paragraph.trim())) ?? paragraphs[0] ?? "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 280);
  const sceneCandidates = buildSceneCandidates(chapter.id, paragraphs);
  const entityCandidates = buildEntityCandidates(content);
  const sentenceCount = Math.max(1, (content.match(/[。！？!?；;]+/gu) ?? []).length);
  const charCount = content.length;
  const wordCount = content.replace(/\s/gu, "").length;
  const dialogueChars = (content.match(/[“”"「」『』]/gu) ?? []).length;
  return {
    schemaVersion: 1,
    chapterId: chapter.id,
    chapterTitle: chapter.title,
    contentHash: sha256(content),
    generatedAt: new Date().toISOString(),
    summary,
    sceneCandidates,
    entityCandidates,
    stats: {
      charCount,
      wordCount,
      paragraphCount: paragraphs.length,
      sentenceCount,
      averageSentenceLength: Number((charCount / sentenceCount).toFixed(2)),
      dialogueRatio: Number((dialogueChars / Math.max(1, charCount)).toFixed(4))
    }
  };
};

const buildSceneCandidates = (chapterId: string, paragraphs: string[]): SceneCandidate[] => {
  let cursor = 0;
  return paragraphs.slice(0, 64).map((paragraph, index) => {
    const startOffset = cursor;
    const endOffset = startOffset + paragraph.length;
    cursor = endOffset + 2;
    return {
      id: `${chapterId}-scene-${String(index + 1).padStart(3, "0")}`,
      startOffset,
      endOffset,
      excerpt: paragraph.replace(/\s+/gu, " ").slice(0, 180),
      contentHash: sha256(paragraph)
    };
  });
};

const buildEntityCandidates = (content: string): EntityCandidate[] => {
  const candidates: EntityCandidate[] = [];
  const patterns: Array<{ kind: EntityCandidate["kind"]; expression: RegExp }> = [
    { kind: "quoted", expression: /[“「『]([^”」』\n]{1,40})[”」』]/gu },
    { kind: "term", expression: /《([^》\n]{1,40})》/gu }
  ];
  for (const { kind, expression } of patterns) {
    for (const match of content.matchAll(expression)) {
      const value = match[1]?.trim();
      if (!value || candidates.some((candidate) => candidate.value === value && candidate.kind === kind)) {
        continue;
      }
      const start = match.index ?? 0;
      candidates.push({ value, kind, evidenceStart: start, evidenceEnd: start + match[0].length });
    }
  }
  return candidates.slice(0, 256);
};

const splitParagraphs = (content: string): string[] =>
  content
    .split(/\r?\n\s*\r?\n/gu)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

const countCompleted = (tasks: AnalysisJobTask[]): number =>
  tasks.filter((task) => task.status === "completed" || task.status === "skipped").length;

const updateTask = (job: AnalysisJob, taskId: string, patch: Partial<AnalysisJobTask>): AnalysisJob => ({
  ...job,
  tasks: job.tasks.map((task) => (task.id === taskId ? { ...task, ...patch } : task)),
  updatedAt: new Date().toISOString()
});

const updateJob = (job: AnalysisJob, patch: Partial<AnalysisJob>): AnalysisJob => ({
  ...job,
  ...patch,
  updatedAt: new Date().toISOString()
});

const checkpointAt = (taskIndex: number, chapterId: string) => ({
  taskIndex,
  lastChapterId: chapterId,
  updatedAt: new Date().toISOString()
});

const cancelPendingTasks = (job: AnalysisJob): AnalysisJob => ({
  ...job,
  tasks: job.tasks.map((task) =>
    task.status === "queued" || task.status === "running"
      ? { ...task, status: "cancelled" as const, error: "Analysis job cancelled by the author." }
      : task
  ),
  updatedAt: new Date().toISOString()
});

const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

const safeId = (value: string): string => value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "job";

const isChapterAnalysis = (value: unknown): value is ChapterAnalysis => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ChapterAnalysis>;
  return (
    candidate.schemaVersion === 1 &&
    typeof candidate.chapterId === "string" &&
    typeof candidate.chapterTitle === "string" &&
    typeof candidate.contentHash === "string" &&
    typeof candidate.generatedAt === "string" &&
    typeof candidate.summary === "string" &&
    Array.isArray(candidate.sceneCandidates) &&
    Array.isArray(candidate.entityCandidates) &&
    Boolean(candidate.stats && typeof candidate.stats === "object")
  );
};

const isMissingFile = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT";
