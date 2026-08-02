import { describe, expect, it } from "vitest";
import {
  CanonFactSchema,
  ChapterContractSchema,
  EvidencePackSchema,
  EvidenceRefSchema,
  StoryThreadSchema,
  migrateClueToStoryThread
} from "../src/index.js";

const evidence = {
  chapterId: "chapter-0001",
  startOffset: 4,
  endOffset: 12,
  excerpt: "褪色车票",
  contentHash: "sha256:ticket"
};

describe("continuation schemas", () => {
  it("rejects invalid evidence ranges and hard facts without evidence", () => {
    expect(() => EvidenceRefSchema.parse({ ...evidence, endOffset: 1 })).toThrow();
    expect(() =>
      CanonFactSchema.parse({
        id: "fact-1",
        subjectId: "林烬",
        predicate: "located_at",
        objectValue: "青州",
        status: "author_locked"
      })
    ).toThrow();
  });

  it("models a chapter contract and evidence pack", () => {
    const contract = ChapterContractSchema.parse({
      chapterId: "chapter-0002",
      mustHappen: ["拿到车票"],
      mustNotHappen: ["揭示幕后人"],
      threadsToAdvance: ["thread-ticket"]
    });
    const pack = EvidencePackSchema.parse({ chapterContract: contract });
    expect(pack.chapterContract.chapterId).toBe("chapter-0002");
    expect(pack.hardConstraints).toEqual([]);
  });

  it("migrates a legacy clue without changing its id", () => {
    const migrated = migrateClueToStoryThread({
      id: "clue-ticket",
      title: "褪色车票",
      plantedChapterId: "chapter-0001",
      relatedCharacters: ["林烬"],
      expectedPayoff: "车票指向旧城",
      status: "developed"
    });
    expect(StoryThreadSchema.parse(migrated)).toMatchObject({
      id: "clue-ticket",
      status: "progressing",
      relatedEntityIds: ["林烬"]
    });
    expect(migrated.setupRefs).toHaveLength(1);
  });
});
