import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AiProviderService } from "./AiProviderService.js";
import { BatchProductionService } from "./BatchProductionService.js";
import { BranchService } from "./BranchService.js";
import { FileRepository } from "./FileRepository.js";
import { ProjectService } from "./ProjectService.js";
import { QualityService } from "./QualityService.js";

const created: string[] = [];

afterEach(async () => {
  for (const directory of created.splice(0)) {
    if (path.resolve(directory).startsWith(path.resolve(os.tmpdir()))) {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

describe("BatchProductionService", () => {
  it("stops at a checkpoint and stores generated text as a branch", async () => {
    const projectPath = await mkdtemp(path.join(os.tmpdir(), "inkforge-batch-"));
    created.push(projectPath);
    const files = new FileRepository();
    await files.writeTextAtomic(path.join(projectPath, "ch-1.md"), "# 第一章\n\n开场");
    await files.writeTextAtomic(path.join(projectPath, "ch-2.md"), "# 第二章\n\n承接");
    const project = {
      projectPath,
      meta: { writingPreferences: { style: "简洁" } },
      outline: {
        volumes: [
          {
            chapters: [
              {
                id: "ch-1",
                title: "第一章",
                file: "ch-1.md",
                goal: "出发",
                characters: [],
                worldRefs: [],
                targetWords: 1000
              },
              {
                id: "ch-2",
                title: "第二章",
                file: "ch-2.md",
                goal: "受阻",
                characters: [],
                worldRefs: [],
                targetWords: 1000
              }
            ]
          }
        ]
      }
    };
    const projects = { openProject: async () => project } as unknown as ProjectService;
    const provider = {
      runTask: async () => ({
        task: "continue" as const,
        text: "新场景",
        providerId: "test",
        model: "test-model",
        contextSummary: "",
        generatedAt: new Date().toISOString(),
        usage: { totalTokens: 100 }
      }),
      cancelTask: () => undefined
    } as unknown as AiProviderService;
    const branchWrites: string[] = [];
    const branches = {
      create: async (input: { content?: string }) => {
        branchWrites.push(input.content ?? "");
        return { id: `branch-${branchWrites.length}` };
      }
    } as unknown as BranchService;
    const quality = {
      evaluateText: async () => ({ overallScore: 90 })
    } as unknown as QualityService;
    const service = new BatchProductionService(files, projects, provider, branches, quality);

    const createdRun = await service.create({
      projectPath,
      chapterIds: ["ch-1", "ch-2"],
      tokenBudget: 10_000,
      checkpointEvery: 1
    });
    const run = await service.resume(projectPath, createdRun.id);

    expect(run.status).toBe("paused");
    expect(run.tasks.map((task) => task.status)).toEqual(["completed", "queued"]);
    expect(run.usedTokens).toBe(100);
    expect(branchWrites[0]).toContain("新场景");
  });
});
