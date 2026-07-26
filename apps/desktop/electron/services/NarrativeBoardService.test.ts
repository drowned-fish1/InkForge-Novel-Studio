import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NarrativeBoardService } from "./NarrativeBoardService.js";

const created: string[] = [];

afterEach(async () => {
  for (const directory of created.splice(0)) {
    if (path.resolve(directory).startsWith(path.resolve(os.tmpdir()))) {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

describe("NarrativeBoardService", () => {
  it("returns an empty board when beats.json does not exist", async () => {
    const projectPath = await mkdtemp(path.join(os.tmpdir(), "inkforge-narrative-"));
    created.push(projectPath);
    const service = new NarrativeBoardService();

    const board = await service.load(projectPath);
    expect(board.acts).toEqual([]);
    expect(board.schemaVersion).toBe("0.1.0");
  });

  it("persists the board and stamps updatedAt", async () => {
    const projectPath = await mkdtemp(path.join(os.tmpdir(), "inkforge-narrative-"));
    created.push(projectPath);
    const service = new NarrativeBoardService();

    const saved = await service.save(projectPath, {
      schemaVersion: "0.1.0",
      updatedAt: "",
      acts: [
        {
          id: "act-1",
          title: "第一幕",
          goal: "",
          beats: [
            {
              id: "beat-1",
              title: "相遇",
              type: "setup",
              summary: "两人在车站相遇。",
              tension: 30,
              characters: [],
              choices: [],
              notes: ""
            }
          ]
        }
      ]
    });
    expect(saved.updatedAt).not.toBe("");

    const loaded = await service.load(projectPath);
    expect(loaded.acts[0].beats[0]).toMatchObject({ id: "beat-1", title: "相遇", tension: 30 });
    expect(loaded.updatedAt).toBe(saved.updatedAt);
  });
});
