import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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
