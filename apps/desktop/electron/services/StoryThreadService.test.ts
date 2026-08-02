import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { StoryThreadService } from "./StoryThreadService.js";

const roots: string[] = [];
const makeRoot = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inkforge-thread-"));
  roots.push(root);
  return root;
};
const ref = (chapterId: string, offset = 0) => ({
  chapterId,
  startOffset: offset,
  endOffset: offset + 4,
  excerpt: "票根",
  contentHash: `${chapterId}-${offset}`
});

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("StoryThreadService", () => {
  it("records setup/progress/payoff evidence without duplicates", async () => {
    const root = await makeRoot();
    const service = new StoryThreadService();
    await service.saveThread(root, {
      id: "thread-ticket",
      type: "foreshadowing",
      title: "褪色车票",
      status: "candidate",
      setupRefs: [],
      progressRefs: [],
      payoffRefs: [],
      expectedPayoff: "指向旧城",
      dependencies: [],
      relatedEntityIds: ["hero"],
      confidence: 0.8,
      locked: false,
      notes: ""
    });
    await service.addSetupEvidence(root, "thread-ticket", ref("chapter-0001"));
    await service.addSetupEvidence(root, "thread-ticket", ref("chapter-0001"));
    await service.addProgressEvidence(root, "thread-ticket", [ref("chapter-0002"), ref("chapter-0003")]);
    const done = await service.addPayoffEvidence(root, "thread-ticket", ref("chapter-0005"));
    expect(done.setupRefs).toHaveLength(1);
    expect(done.progressRefs).toHaveLength(2);
    expect(done.payoffRefs).toHaveLength(1);
    expect(await service.listDueThreads(root, 5)).toHaveLength(0);
    expect(await service.listThreads(root, { relatedEntityId: "hero" })).toHaveLength(1);
    expect((await readFile(path.join(root, "canon", "story-threads.jsonl"), "utf8")).trim()).toContain("thread-ticket");
  });

  it("migrates legacy clues once and preserves authored threads", async () => {
    const root = await makeRoot();
    await writeFile(
      path.join(root, "clues.json"),
      JSON.stringify([
        {
          id: "clue-1",
          title: "旧印记",
          plantedChapterId: "chapter-0001",
          relatedCharacters: ["hero"],
          expectedPayoff: "真相",
          status: "planted",
          notes: ""
        }
      ]),
      "utf8"
    );
    const service = new StoryThreadService();
    const migrated = await service.listThreads(root);
    expect(migrated).toHaveLength(1);
    expect(migrated[0].status).toBe("active");
    const again = await service.migrateLegacyClues(root);
    expect(again).toHaveLength(1);
    await service.setStatus(root, "clue-1", "progressing");
    const afterEdit = await service.listThreads(root);
    expect(afterEdit[0].status).toBe("progressing");
  });

  it("rejects dependency cycles and reports missing dependencies", async () => {
    const root = await makeRoot();
    const service = new StoryThreadService();
    const base = (id: string, dependencies: string[]) => ({
      id,
      type: "mystery" as const,
      title: id,
      status: "active" as const,
      setupRefs: [ref("chapter-0001")],
      progressRefs: [],
      payoffRefs: [],
      expectedPayoff: "",
      dependencies,
      relatedEntityIds: [],
      confidence: 0.5,
      locked: false,
      notes: ""
    });
    await service.saveThread(root, base("a", ["missing"]));
    expect((await service.validateDependencies(root)).missing).toEqual(["missing"]);
    await service.saveThread(root, base("b", ["a"]));
    await expect(service.saveThread(root, base("a", ["b"]))).rejects.toThrow(/cycle/u);
  });
});
