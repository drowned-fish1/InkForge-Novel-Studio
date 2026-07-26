import { randomUUID } from "node:crypto";
import { BatchRunSchema, type BatchRun, type BatchTask } from "@inkforge/schemas";
import type { CreateBatchRunInput } from "../types.js";
import { AiProviderService } from "./AiProviderService.js";
import { BranchService } from "./BranchService.js";
import { FileRepository } from "./FileRepository.js";
import { ProjectService } from "./ProjectService.js";
import { QualityService } from "./QualityService.js";

export class BatchProductionService {
  private readonly cancelledRuns = new Set<string>();
  private readonly activeRequests = new Map<string, string>();

  constructor(
    private readonly files = new FileRepository(),
    private readonly projects = new ProjectService(files),
    private readonly provider = new AiProviderService(),
    private readonly branches = new BranchService(files, projects),
    private readonly quality = new QualityService(files, projects)
  ) {}

  async list(projectPath: string): Promise<BatchRun[]> {
    try {
      const raw = await this.files.readJson<unknown[]>(this.path(projectPath));
      return raw
        .map((item) => BatchRunSchema.parse(item))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    } catch {
      return [];
    }
  }

  async create(input: CreateBatchRunInput): Promise<BatchRun> {
    const project = await this.projects.openProject(input.projectPath);
    const allChapters = project.outline.volumes.flatMap((volume) => volume.chapters);
    const selected = input.chapterIds.map((chapterId) => {
      const chapter = allChapters.find((item) => item.id === chapterId);
      if (!chapter) {
        throw new Error(`Chapter not found: ${chapterId}`);
      }
      return chapter;
    });
    if (!selected.length) {
      throw new Error("Select at least one chapter.");
    }
    const now = new Date().toISOString();
    const tasks: BatchTask[] = selected.map((chapter) => ({
      id: randomUUID(),
      chapterId: chapter.id,
      chapterTitle: chapter.title,
      status: "queued",
      estimatedTokens: Math.max(800, Math.ceil(chapter.targetWords * 1.8)),
      actualTokens: 0,
      error: ""
    }));
    const run = BatchRunSchema.parse({
      id: randomUUID(),
      status: "draft",
      tasks,
      tokenBudget: input.tokenBudget,
      usedTokens: 0,
      checkpointEvery: input.checkpointEvery,
      completedSinceCheckpoint: 0,
      createdAt: now,
      updatedAt: now,
      logs: [
        `已创建 ${tasks.length} 个章节任务；草稿只进入分支，不会覆盖正文。`,
        input.instruction?.trim() ? `批次要求：${input.instruction.trim()}` : "批次要求：延续章节目标并生成可审阅草稿。"
      ]
    });
    await this.upsert(input.projectPath, run);
    return run;
  }

  async resume(projectPath: string, runId: string): Promise<BatchRun> {
    this.cancelledRuns.delete(runId);
    let run = await this.requireRun(projectPath, runId);
    if (["completed", "cancelled"].includes(run.status)) {
      return run;
    }
    run = this.update(run, {
      status: "running",
      completedSinceCheckpoint: 0,
      logs: [...run.logs, "开始执行至下一个人工检查点。"]
    });
    await this.upsert(projectPath, run);
    const project = await this.projects.openProject(projectPath);
    const chapters = project.outline.volumes.flatMap((volume) => volume.chapters);

    for (const task of run.tasks.filter((item) => item.status === "queued" || item.status === "failed")) {
      if (this.cancelledRuns.has(runId)) {
        break;
      }
      if (run.usedTokens + task.estimatedTokens > run.tokenBudget) {
        run = this.update(run, {
          status: "paused",
          logs: [...run.logs, `预算保护：${task.chapterTitle} 的预计消耗将超过剩余预算。`]
        });
        break;
      }
      const chapter = chapters.find((item) => item.id === task.chapterId);
      if (!chapter) {
        run = updateTask(run, task.id, { status: "failed", error: "章节已不存在。" });
        continue;
      }
      const content = await this.files.readText(this.files.assertInsideProject(projectPath, chapter.file));
      run = updateTask(run, task.id, { status: "running", error: "" });
      await this.upsert(projectPath, run);
      const requestId = `batch-${run.id}-${task.id}`;
      this.activeRequests.set(run.id, requestId);
      try {
        const result = await this.provider.runTask({
          requestId,
          projectPath,
          task: content.trim().length > 80 ? "continue" : "expand",
          instruction: run.logs[1] ?? "延续章节目标并生成可审阅草稿。",
          chapterTitle: chapter.title,
          chapterGoal: chapter.goal,
          recentText: content.slice(-12_000),
          characters: chapter.characters,
          worldFacts: chapter.worldRefs,
          style: project.meta.writingPreferences.style
        });
        if (this.cancelledRuns.has(runId)) {
          throw new Error("Batch run cancelled.");
        }
        const branchContent = content.trimEnd() + "\n\n" + result.text.trim() + "\n";
        const branch = await this.branches.create({
          projectPath,
          chapterId: chapter.id,
          name: `批量草稿 · ${new Date().toLocaleString("zh-CN", { hour12: false })}`,
          description: "批量生产生成；应用前请检查差异和质量报告。",
          content: branchContent,
          source: "batch"
        });
        const report = await this.quality.evaluateText(chapter.id, chapter.title, branchContent);
        const actualTokens = result.usage?.totalTokens ?? Math.max(1, Math.ceil(result.text.length / 2.4));
        run = updateTask(run, task.id, {
          status: "completed",
          actualTokens,
          branchId: branch.id,
          qualityScore: report.overallScore
        });
        run = this.update(run, {
          usedTokens: run.usedTokens + actualTokens,
          completedSinceCheckpoint: run.completedSinceCheckpoint + 1,
          logs: [...run.logs, `${chapter.title} 已生成分支草稿，质量分 ${report.overallScore}。`]
        });
      } catch (error) {
        const cancelled = this.cancelledRuns.has(runId);
        run = updateTask(run, task.id, {
          status: cancelled ? "cancelled" : "failed",
          error: cancelled ? "任务已取消。" : error instanceof Error ? error.message : String(error)
        });
        if (!cancelled) {
          run = this.update(run, { logs: [...run.logs, `${chapter.title} 失败，已保留队列供重试。`] });
        }
      } finally {
        this.activeRequests.delete(run.id);
      }
      await this.upsert(projectPath, run);
      if (run.completedSinceCheckpoint >= run.checkpointEvery) {
        run = this.update(run, {
          status: run.tasks.every((item) => item.status === "completed") ? "completed" : "paused",
          logs: [...run.logs, "已到达人工检查点。请审阅分支后再继续。"]
        });
        break;
      }
    }

    if (this.cancelledRuns.has(runId)) {
      run = this.update(run, {
        status: "cancelled",
        tasks: run.tasks.map((task) =>
          task.status === "queued" || task.status === "running"
            ? { ...task, status: "cancelled" as const, error: "任务已取消。" }
            : task
        ),
        logs: [...run.logs, "批量任务已取消，已生成的分支仍然保留。"]
      });
    } else if (run.status === "running") {
      run = this.update(run, {
        status: run.tasks.every((item) => item.status === "completed") ? "completed" : "paused"
      });
    }
    await this.upsert(projectPath, run);
    return run;
  }

  async cancel(projectPath: string, runId: string): Promise<BatchRun> {
    this.cancelledRuns.add(runId);
    const requestId = this.activeRequests.get(runId);
    if (requestId) {
      this.provider.cancelTask(requestId);
    }
    const run = await this.requireRun(projectPath, runId);
    const updated = this.update(run, {
      status: "cancelled",
      tasks: run.tasks.map((task) =>
        task.status === "queued" || task.status === "running"
          ? { ...task, status: "cancelled" as const, error: "任务已取消。" }
          : task
      ),
      logs: [...run.logs, "已请求取消批量任务。"]
    });
    await this.upsert(projectPath, updated);
    return updated;
  }

  private async requireRun(projectPath: string, runId: string): Promise<BatchRun> {
    const run = (await this.list(projectPath)).find((item) => item.id === runId);
    if (!run) {
      throw new Error("Batch run not found.");
    }
    return run;
  }

  private update(run: BatchRun, patch: Partial<BatchRun>): BatchRun {
    return BatchRunSchema.parse({ ...run, ...patch, updatedAt: new Date().toISOString() });
  }

  private async upsert(projectPath: string, run: BatchRun): Promise<void> {
    const runs = await this.list(projectPath);
    await this.files.writeJsonAtomic(
      this.path(projectPath),
      [run, ...runs.filter((item) => item.id !== run.id)].slice(0, 50)
    );
  }

  private path(projectPath: string): string {
    return this.files.assertInsideProject(projectPath, ".inkforge/batch-runs.json");
  }
}

const updateTask = (run: BatchRun, taskId: string, patch: Partial<BatchTask>): BatchRun =>
  BatchRunSchema.parse({
    ...run,
    tasks: run.tasks.map((task) => (task.id === taskId ? { ...task, ...patch } : task)),
    updatedAt: new Date().toISOString()
  });
