import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ScenePlanService } from "./ScenePlanService.js";

const created: string[] = [];

afterEach(async () => {
  for (const directory of created.splice(0)) {
    if (path.resolve(directory).startsWith(path.resolve(os.tmpdir()))) {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

describe("ScenePlanService", () => {
  it("persists scene plans inside the project and normalizes their order", async () => {
    const projectPath = await mkdtemp(path.join(os.tmpdir(), "inkforge-scenes-"));
    created.push(projectPath);
    const service = new ScenePlanService();

    await service.save(projectPath, "chapter-1", [
      {
        schemaVersion: "0.1.0",
        id: "scene-b",
        chapterId: "chapter-1",
        order: 8,
        title: "转折",
        location: "",
        time: "",
        goal: "揭示线索",
        conflict: "代价上升",
        outcome: "主角改变计划",
        beats: [],
        requiredCharacters: [],
        worldRefs: [],
        clueRefs: [],
        decisionPoints: [],
        notes: ""
      }
    ]);

    const scenes = await service.list(projectPath, "chapter-1");
    expect(scenes).toHaveLength(1);
    expect(scenes[0]).toMatchObject({ id: "scene-b", order: 0, title: "转折" });
  });
});
