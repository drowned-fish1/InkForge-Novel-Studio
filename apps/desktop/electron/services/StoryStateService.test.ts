import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileRepository } from "./FileRepository.js";
import { LibraryService } from "./LibraryService.js";
import { ProjectService } from "./ProjectService.js";
import { StoryStateService } from "./StoryStateService.js";

const temporaryProjects: string[] = [];

const createProjectFixture = async () => {
  const projectPath = await mkdtemp(path.join(os.tmpdir(), "inkforge-story-"));
  temporaryProjects.push(projectPath);
  return projectPath;
};

afterEach(async () => {
  for (const projectPath of temporaryProjects.splice(0)) {
    await rm(projectPath, { recursive: true, force: true });
  }
});

describe("StoryStateService conflicts", () => {
  it("saves, upserts and deletes conflicts in conflicts.json", async () => {
    const projectPath = await createProjectFixture();
    const service = new StoryStateService();

    await service.saveConflict(projectPath, {
      id: "conf-1",
      title: "主线冲突",
      kind: "main",
      status: "active",
      parties: ["林烬", "缉私队"],
      stakes: "车票背后的储物柜",
      relatedCharacters: [],
      relatedFactions: [],
      chapterIds: [],
      summary: "",
      notes: ""
    });
    const afterUpdate = await service.saveConflict(projectPath, {
      id: "conf-1",
      title: "主线冲突（升级）",
      kind: "main",
      status: "escalating",
      parties: ["林烬", "缉私队"],
      stakes: "",
      relatedCharacters: [],
      relatedFactions: [],
      chapterIds: [],
      summary: "",
      notes: ""
    });
    expect(afterUpdate).toHaveLength(1);
    expect(afterUpdate[0].status).toBe("escalating");

    const afterDelete = await service.deleteConflict(projectPath, "conf-1");
    expect(afterDelete).toHaveLength(0);
    expect(await service.listConflicts(projectPath)).toHaveLength(0);
  });

  it("deletes timeline events, clues and terms", async () => {
    const projectPath = await createProjectFixture();
    const service = new StoryStateService();

    await service.saveTimelineEvent(projectPath, {
      id: "ev-1",
      order: 1,
      title: "事件",
      location: "",
      participants: [],
      summary: ""
    });
    await service.saveClue(projectPath, {
      id: "clue-1",
      title: "伏笔",
      relatedCharacters: [],
      expectedPayoff: "",
      status: "planned",
      notes: ""
    });
    await service.saveTerm(projectPath, {
      id: "term-1",
      name: "术语",
      category: "term",
      aliases: [],
      definition: "",
      locked: false
    });

    expect(await service.deleteTimelineEvent(projectPath, "ev-1")).toHaveLength(0);
    expect(await service.deleteClue(projectPath, "clue-1")).toHaveLength(0);
    expect(await service.deleteTerm(projectPath, "term-1")).toHaveLength(0);
  });
});

describe("StoryStateService inspect reference checks", () => {
  it("flags unknown chapter characters, missing world refs and dangling conflict chapters", async () => {
    const root = await createProjectFixture();
    const files = new FileRepository();
    const projects = new ProjectService(files);
    const library = new LibraryService(files);
    const service = new StoryStateService(files, projects, library);
    const project = await projects.createProject(root, {
      title: "一致性测试",
      author: "tester",
      genre: [],
      targetWords: 100000,
      style: "",
      protagonist: "",
      premise: ""
    });
    const chapter = project.outline.volumes[0].chapters[0];
    project.outline.volumes[0].chapters[0] = {
      ...chapter,
      characters: ["林烬", "不存在的人"],
      worldRefs: ["旧车站", "未登记的地方"]
    };
    await projects.updateOutline({ projectPath: project.projectPath, outline: project.outline });
    await library.saveCharacter(project.projectPath, {
      id: "char-1",
      name: "林烬",
      aliases: ["阿烬"],
      role: "protagonist",
      tags: [],
      profile: { age: "", identity: "", motivation: "", personality: "" },
      currentState: { arc: "", powerLevel: "", location: "", relationships: [], secrets: [] },
      voiceNotes: ""
    });
    await library.saveWorldEntry(project.projectPath, {
      id: "world-1",
      title: "旧车站",
      type: "location",
      locked: false,
      tags: [],
      summary: "",
      content: "",
      relatedCharacters: [],
      relatedClues: []
    });
    await service.saveConflict(project.projectPath, {
      id: "conf-1",
      title: "主线冲突",
      kind: "main",
      status: "active",
      parties: [],
      stakes: "",
      relatedCharacters: [],
      relatedFactions: [],
      chapterIds: [chapter.id, "chapter-deleted"],
      summary: "",
      notes: ""
    });

    const issues = await service.inspect(project.projectPath);
    const unknownCharacter = issues.find((issue) => issue.id === "chapter-unknown-character-不存在的人");
    expect(unknownCharacter?.severity).toBe("warning");
    expect(unknownCharacter?.detail).toContain(chapter.title);
    expect(issues.some((issue) => issue.id === "chapter-unknown-character-林烬")).toBe(false);
    const unknownWorld = issues.find((issue) => issue.id === "chapter-unknown-worldref-未登记的地方");
    expect(unknownWorld?.severity).toBe("warning");
    expect(issues.some((issue) => issue.id === "chapter-unknown-worldref-旧车站")).toBe(false);
    const danglingConflict = issues.find((issue) => issue.id === "conflict-bad-chapter-conf-1");
    expect(danglingConflict?.severity).toBe("error");
    expect(danglingConflict?.detail).toContain("chapter-deleted");
  });
});
