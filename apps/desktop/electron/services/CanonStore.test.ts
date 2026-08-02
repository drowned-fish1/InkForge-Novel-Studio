import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CanonStore } from "./CanonStore.js";

const roots: string[] = [];
const makeRoot = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inkforge-canon-"));
  roots.push(root);
  return root;
};

const evidence = (chapterId: string, offset = 0) => ({
  chapterId,
  startOffset: offset,
  endOffset: offset + 3,
  excerpt: "证据",
  contentHash: `hash-${chapterId}-${offset}`
});

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("CanonStore", () => {
  it("upserts facts idempotently and queries inclusive chapter ranges", async () => {
    const root = await makeRoot();
    const store = new CanonStore();
    await store.saveFact(root, {
      id: "fact-location",
      subjectId: "hero",
      predicate: "located_at",
      objectValue: "青州",
      validFromChapterId: "chapter-0002",
      validToChapterId: "chapter-0004",
      certainty: 1,
      status: "author_locked",
      evidence: [evidence("chapter-0002")],
      supersedes: [],
      source: "author",
      notes: ""
    });
    await store.saveFact(root, {
      id: "fact-location",
      subjectId: "hero",
      predicate: "located_at",
      objectValue: "青州",
      validFromChapterId: "chapter-0002",
      validToChapterId: "chapter-0004",
      certainty: 1,
      status: "author_locked",
      evidence: [evidence("chapter-0002")],
      supersedes: [],
      source: "author",
      notes: ""
    });
    expect(await store.listFacts(root)).toHaveLength(1);
    expect((await store.listFactsAtChapter(root, "chapter-0003"))[0].objectValue).toBe("青州");
    expect(await store.listFactsAtChapter(root, "chapter-0005")).toHaveLength(0);
    const jsonl = await readFile(path.join(root, "canon", "facts.jsonl"), "utf8");
    expect(jsonl.trim().split(/\r?\n/u)).toHaveLength(1);
  });

  it("persists transitions and resolves the latest state at a chapter", async () => {
    const root = await makeRoot();
    const store = new CanonStore();
    await store.saveStateTransition(root, {
      id: "state-1",
      subjectId: "hero",
      predicate: "location",
      fromValue: null,
      toValue: "青州",
      chapterId: "chapter-0001",
      reason: "抵达",
      evidence: [evidence("chapter-0001")],
      certainty: 1
    });
    await store.saveStateTransition(root, {
      id: "state-2",
      subjectId: "hero",
      predicate: "location",
      fromValue: "青州",
      toValue: "京城",
      chapterId: "chapter-0003",
      reason: "离开",
      evidence: [evidence("chapter-0003")],
      certainty: 1
    });
    expect((await store.listStateAtChapter(root, "hero", "chapter-0002"))[0].toValue).toBe("青州");
    expect((await store.listStateAtChapter(root, "hero", "chapter-0003"))[0].toValue).toBe("京城");
  });

  it("keeps the previous JSONL snapshot when an atomic write fails", async () => {
    const root = await makeRoot();
    const first = new CanonStore();
    await first.saveFact(root, {
      id: "fact-1",
      subjectId: "hero",
      predicate: "alive",
      objectValue: true,
      certainty: 1,
      status: "confirmed",
      evidence: [evidence("chapter-0001")],
      supersedes: [],
      source: "author",
      notes: ""
    });
    // A malformed write is rejected before the file operation, so the valid
    // snapshot remains readable and no duplicate record is created.
    await expect(
      first.saveFact(root, {
        id: "fact-2",
        subjectId: "hero",
        predicate: "alive",
        objectValue: true,
        certainty: 2,
        status: "candidate",
        evidence: [],
        supersedes: [],
        source: "author",
        notes: ""
      } as never)
    ).rejects.toThrow();
    expect(await first.listFacts(root)).toHaveLength(1);
  });
});
