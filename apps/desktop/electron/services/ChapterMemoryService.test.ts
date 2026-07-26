import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ChapterPlan } from "@inkforge/schemas";
import { ChapterMemoryService } from "./ChapterMemoryService.js";

const created: string[] = [];

afterEach(async () => {
  for (const directory of created.splice(0)) {
    if (path.resolve(directory).startsWith(path.resolve(os.tmpdir()))) {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

const chapter = (number: number): ChapterPlan => ({
  id: `chapter-${number}`,
  number,
  title: `第 ${number} 章`,
  file: `chapters/${number}.md`,
  goal: "",
  hook: "",
  status: "planned",
  targetWords: 3000,
  actualWords: 0,
  archived: false,
  notes: "",
  conflictPoints: "",
  characters: [],
  worldRefs: []
});

describe("ChapterMemoryService context", () => {
  it("restores both existing and previously absent chapter memories from snapshots", async () => {
    const projectPath = await mkdtemp(path.join(os.tmpdir(), "inkforge-memory-snapshot-"));
    created.push(projectPath);
    const service = new ChapterMemoryService();
    const original = {
      schemaVersion: "0.1.0" as const,
      chapterId: "chapter-1",
      summary: "原始记忆",
      characterStates: [],
      unresolvedThreads: ["旧线索"],
      clueUpdates: [],
      worldStateChanges: [],
      keywords: ["旧状态"],
      updatedAt: "2026-01-01T00:00:00.000Z"
    };

    await service.save(projectPath, original);
    await service.createSnapshot(projectPath, original.chapterId, "existing-memory");
    await service.save(projectPath, { ...original, summary: "被修改的记忆" });
    await service.restoreSnapshot(projectPath, "existing-memory");
    expect((await service.load(projectPath, original.chapterId))?.summary).toBe("原始记忆");

    await service.createSnapshot(projectPath, "chapter-2", "absent-memory");
    await service.save(projectPath, { ...original, chapterId: "chapter-2", summary: "新增记忆" });
    await service.restoreSnapshot(projectPath, "absent-memory");
    expect(await service.load(projectPath, "chapter-2")).toBeUndefined();
  });

  it("keeps recent memories and persists a compressed digest for older chapters", async () => {
    const projectPath = await mkdtemp(path.join(os.tmpdir(), "inkforge-memory-"));
    created.push(projectPath);
    const service = new ChapterMemoryService();
    const chapters = Array.from({ length: 7 }, (_, index) => chapter(index + 1));
    for (const item of chapters) {
      await service.save(projectPath, {
        schemaVersion: "0.1.0",
        chapterId: item.id,
        summary: `${item.title}发生了关键事件`,
        characterStates: [],
        unresolvedThreads: [`线索${item.number}`],
        clueUpdates: [],
        worldStateChanges: [],
        keywords: ["星门"],
        updatedAt: "2026-01-01T00:00:00.000Z"
      });
    }

    const context = await service.buildContext(projectPath, chapters, 6, 300, 3);

    expect(context.recentMemories).toBe(3);
    expect(context.compressedMemories).toBe(4);
    expect(context.estimatedTokens).toBeLessThanOrEqual(300);
    expect(context.content).toContain("更早章节压缩记忆");
    const digest = await readFile(
      path.join(projectPath, ".inkforge", "agents", "memory", "project-digest.json"),
      "utf8"
    );
    expect(digest).toContain("chapter-1");
  });
});
