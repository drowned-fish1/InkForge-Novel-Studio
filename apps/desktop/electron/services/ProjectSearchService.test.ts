import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ChapterService } from "./ChapterService.js";
import { FileRepository } from "./FileRepository.js";
import { LibraryService } from "./LibraryService.js";
import { ProjectSearchService } from "./ProjectSearchService.js";
import { ProjectService } from "./ProjectService.js";
import { StoryStateService } from "./StoryStateService.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("ProjectSearchService", () => {
  it("finds chapter content with offsets and entity names", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "inkforge-search-"));
    temporaryRoots.push(root);
    const files = new FileRepository();
    const projects = new ProjectService(files);
    const chapters = new ChapterService(files);
    const library = new LibraryService(files);
    const story = new StoryStateService(files, projects);
    const search = new ProjectSearchService(files, projects, library, story);
    const project = await projects.createProject(root, {
      title: "搜索测试",
      author: "tester",
      genre: [],
      targetWords: 100000,
      style: "",
      protagonist: "",
      premise: ""
    });
    const chapter = project.outline.volumes[0].chapters[0];
    await chapters.saveChapter({
      projectPath: project.projectPath,
      file: chapter.file,
      content: "开场铺垫。\n\n他捏着褪色车票走进车站，票根上的编号已经模糊。\n\n结尾。"
    });
    await library.saveCharacter(project.projectPath, {
      id: "char-1",
      name: "林烬",
      aliases: [],
      role: "protagonist",
      tags: [],
      profile: { age: "", identity: "捡到车票的人", motivation: "", personality: "" },
      currentState: { arc: "", powerLevel: "", location: "", relationships: [], secrets: [] },
      voiceNotes: ""
    });

    const results = await search.search(project.projectPath, "车票");
    const chapterHit = results.find((item) => item.kind === "chapter");
    expect(chapterHit).toBeDefined();
    expect(chapterHit?.offset).toBeGreaterThan(0);
    expect(chapterHit?.snippet).toContain("车票");
    const characterHit = results.find((item) => item.kind === "character");
    expect(characterHit?.title).toBe("林烬");

    expect(await search.search(project.projectPath, "  ")).toEqual([]);
    const titleOnly = await search.search(project.projectPath, chapter.title.slice(0, 2));
    expect(titleOnly.some((item) => item.kind === "chapter")).toBe(true);
  });
});
