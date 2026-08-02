import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AnalysisJobService } from "./AnalysisJobService.js";
import { CorpusImportService } from "./CorpusImportService.js";
import { FileRepository } from "./FileRepository.js";

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

const createRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inkforge-analysis-"));
  roots.push(root);
  return root;
};

describe("AnalysisJobService", () => {
  it("analyzes imported chapters and reuses same-hash artifacts", async () => {
    const root = await createRoot();
    const projectPath = path.join(root, "project");
    const source = path.join(root, "source.md");
    await writeFile(source, "# 第一章\n‘甲’走进《青州》。\n\n他停下。\n# 第二章\n乙回答。\n", "utf8");
    const files = new FileRepository();
    const imports = new CorpusImportService(files);
    const manifest = await imports.import({ projectPath, sourcePath: source });
    const service = new AnalysisJobService(files, imports);
    const first = await service.start({ projectPath, importId: manifest.id });
    expect(first.status).toBe("completed");
    expect(first.completedTasks).toBe(2);
    const report = await service.readAnalysis(projectPath, first, first.tasks[0]);
    expect(report?.contentHash).toBe(manifest.chapters[0].contentHash);
    expect(report?.sceneCandidates.length).toBeGreaterThan(0);
    expect(report?.entityCandidates.some((candidate) => candidate.kind === "term")).toBe(true);

    const second = await service.start({ projectPath, importId: manifest.id });
    expect(second.status).toBe("completed");
    expect(second.tasks.every((task) => task.status === "skipped" && task.reused)).toBe(true);
  });

  it("pauses at a durable task checkpoint and resumes after process restart", async () => {
    const root = await createRoot();
    const projectPath = path.join(root, "project");
    const source = path.join(root, "source.md");
    await writeFile(source, "# 第一章\n一\n# 第二章\n二\n# 第三章\n三\n", "utf8");
    const files = new FileRepository();
    const imports = new CorpusImportService(files);
    const manifest = await imports.import({ projectPath, sourcePath: source });
    const service = new AnalysisJobService(files, imports);
    let requestedPause = false;
    const partial = await service.start({
      projectPath,
      importId: manifest.id,
      onProgress: async (progress) => {
        if (!requestedPause && progress.completedTasks === 1 && progress.status === "running") {
          requestedPause = true;
          await service.pause(projectPath, progress.jobId);
        }
      }
    });
    expect(partial.status).toBe("paused");
    expect(partial.completedTasks).toBe(1);
    const restarted = new AnalysisJobService(files, imports);
    const resumed = await restarted.resume(projectPath, partial.id);
    expect(resumed.status).toBe("completed");
    expect(resumed.completedTasks).toBe(3);
  });

  it("persists cancellation without discarding completed analysis", async () => {
    const root = await createRoot();
    const projectPath = path.join(root, "project");
    const source = path.join(root, "source.md");
    await writeFile(source, "# 第一章\n一\n# 第二章\n二\n", "utf8");
    const files = new FileRepository();
    const imports = new CorpusImportService(files);
    const manifest = await imports.import({ projectPath, sourcePath: source });
    const service = new AnalysisJobService(files, imports);
    const cancelled = await service.start({
      projectPath,
      importId: manifest.id,
      onProgress: async (progress) => {
        if (progress.completedTasks === 1 && progress.status === "running") {
          await service.cancel(projectPath, progress.jobId);
        }
      }
    });
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.tasks[0].status).toBe("completed");
    expect(cancelled.tasks[1].status).toBe("cancelled");
    const persisted = JSON.parse(
      await readFile(path.join(projectPath, ".inkforge", "continuation", "jobs", `${cancelled.id}.json`), "utf8")
    ) as { status: string };
    expect(persisted.status).toBe("cancelled");
  });
});
