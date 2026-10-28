import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BranchService, diffLines } from "./BranchService.js";
import { ProjectService } from "./ProjectService.js";
import { FileRepository } from "./FileRepository.js";

describe("story branch diff", () => {
  it("refuses concurrent manuscript changes and does not reapply accepted branches", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "inkforge-branches-conflict-"));
    try {
      const files = new FileRepository();
      const projects = new ProjectService(files);
      const project = await projects.createProject(root, {
        title: "分支保护",
        author: "",
        genre: [],
        targetWords: 10000,
        style: "",
        protagonist: "",
        premise: ""
      });
      const chapter = project.outline.volumes[0].chapters[0];
      const file = files.assertInsideProject(project.projectPath, chapter.file);
      await files.writeTextAtomic(file, "原文");
      const service = new BranchService(files, projects);
      const branch = await service.create({
        projectPath: project.projectPath,
        chapterId: chapter.id,
        name: "候选",
        content: "修订",
        expectedBaseContent: "原文"
      });
      await files.writeTextAtomic(file, "作者新内容");
      await expect(service.apply(project.projectPath, branch.id)).rejects.toThrow("已变化");
      expect(await files.readText(file)).toBe("作者新内容");
      await files.writeTextAtomic(file, "原文");
      expect((await service.apply(project.projectPath, branch.id)).status).toBe("applied");
      expect((await service.apply(project.projectPath, branch.id)).status).toBe("applied");
      expect(await files.readText(file)).toBe("修订");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("keeps context order and marks additions and removals", () => {
    const diff = diffLines("第一行\n旧转折\n结尾", "第一行\n新转折\n结尾");

    expect(diff).toEqual([
      { kind: "context", text: "第一行" },
      { kind: "add", text: "新转折" },
      { kind: "remove", text: "旧转折" },
      { kind: "context", text: "结尾" }
    ]);
  });

  it("does not treat a corrupt branch file as an empty collection", async () => {
    const projectPath = await mkdtemp(path.join(os.tmpdir(), "inkforge-branches-corrupt-"));
    try {
      await mkdir(path.join(projectPath, ".inkforge"), { recursive: true });
      await writeFile(path.join(projectPath, ".inkforge", "story-branches.json"), "{broken", "utf8");

      await expect(new BranchService().list(projectPath)).rejects.toThrow();
    } finally {
      await rm(projectPath, { recursive: true, force: true });
    }
  });

  it("refuses to apply a continuation branch with unresolved hard failures", async () => {
    const projectPath = await mkdtemp(path.join(os.tmpdir(), "inkforge-branch-blocked-"));
    try {
      await mkdir(path.join(projectPath, ".inkforge", "continuation"), { recursive: true });
      const now = new Date().toISOString();
      await writeFile(
        path.join(projectPath, ".inkforge", "story-branches.json"),
        JSON.stringify([
          {
            schemaVersion: "0.1.0",
            id: "branch-blocked",
            chapterId: "ch-1",
            name: "blocked",
            description: "",
            baseFingerprint: "hash",
            baseContent: "",
            content: "draft",
            status: "draft",
            source: "agent",
            createdAt: now,
            updatedAt: now
          }
        ]),
        "utf8"
      );
      await writeFile(
        path.join(projectPath, ".inkforge", "continuation", "runs.json"),
        JSON.stringify([{ branchId: "branch-blocked", status: "blocked", validation: { hardFailures: 1 } }]),
        "utf8"
      );
      await expect(new BranchService().apply(projectPath, "branch-blocked")).rejects.toThrow("硬冲突");
    } finally {
      await rm(projectPath, { recursive: true, force: true });
    }
  });
});
