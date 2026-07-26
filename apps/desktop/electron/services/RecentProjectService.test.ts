import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ProjectService } from "./ProjectService.js";
import { RecentProjectService } from "./RecentProjectService.js";

describe("RecentProjectService", () => {
  it("persists opened projects and drops missing directories", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "inkforge-recents-"));
    try {
      const project = await new ProjectService().createProject(root, {
        title: "最近项目",
        author: "作者",
        genre: [],
        targetWords: 100_000,
        style: "",
        protagonist: "",
        premise: ""
      });
      const registryPath = path.join(root, "user-data", "recent-projects.json");
      const service = new RecentProjectService(registryPath);

      await service.touch(project);
      expect(await service.list()).toMatchObject([
        { projectPath: project.projectPath, title: "最近项目", chapterCount: 1 }
      ]);

      await rm(project.projectPath, { recursive: true, force: true });
      expect(await service.list()).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
