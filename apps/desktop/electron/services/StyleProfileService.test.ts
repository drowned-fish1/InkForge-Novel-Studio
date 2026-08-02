import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileRepository } from "./FileRepository.js";
import { ProjectService } from "./ProjectService.js";
import { StyleProfileService } from "./StyleProfileService.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("StyleProfileService", () => {
  it("builds a persisted baseline without concatenating the manuscript", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "inkforge-style-"));
    roots.push(root);
    const files = new FileRepository();
    const projects = new ProjectService(files);
    const project = await projects.createProject(root, {
      title: "长篇测试",
      author: "author",
      genre: [],
      targetWords: 100_000,
      style: "",
      protagonist: "",
      premise: ""
    });
    const chapter = project.outline.volumes[0].chapters[0];
    await files.writeTextAtomic(
      files.assertInsideProject(project.projectPath, chapter.file),
      "雨停了。风穿过长街。\n\n“你回来了？”她站在门边问。\n"
    );
    const service = new StyleProfileService(files, projects);
    const result = await service.analyzeProject(project.projectPath);
    expect(result.analyzedChapters).toBe(1);
    expect(result.profile.sentenceLengthMean).toBeGreaterThan(0);
    expect(result.profile.evidence[0]?.chapterId).toBe(chapter.id);
    expect(await service.load(project.projectPath)).toMatchObject({ id: "default", version: 1 });
  });

  it("evaluates drift against the stored baseline", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "inkforge-style-"));
    roots.push(root);
    const files = new FileRepository();
    const projects = new ProjectService(files);
    const project = await projects.createProject(root, {
      title: "风格偏移",
      author: "author",
      genre: [],
      targetWords: 100_000,
      style: "",
      protagonist: "",
      premise: ""
    });
    const chapter = project.outline.volumes[0].chapters[0];
    const source = "他停下。她回头。雨落下来。灯熄灭了。";
    await files.writeTextAtomic(files.assertInsideProject(project.projectPath, chapter.file), source);
    const service = new StyleProfileService(files, projects);
    await service.analyzeProject(project.projectPath);
    expect((await service.evaluateText(project.projectPath, source)).score).toBe(100);
    expect(
      (
        await service.evaluateText(
          project.projectPath,
          "“你为什么一定要在这个时候把所有完全没有必要解释的事情一口气全说出来呢？”她不断地问。",
          0.2
        )
      ).warnings.length
    ).toBeGreaterThan(0);
  });
});
