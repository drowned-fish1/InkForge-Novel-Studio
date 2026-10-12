import { describe, expect, it } from "vitest";
import {
  CharacterSchema,
  ChapterPlanSchema,
  ClueSchema,
  ConflictSchema,
  OutlineSchema,
  ScenePlanSchema,
  StoryThreadSchema
} from "@inkforge/schemas";
import { buildStoryMatrix, matrixChapters, matrixCsv, type StoryMatrixInput } from "./storyMatrix";

const fixture = (): StoryMatrixInput => ({
  outline: OutlineSchema.parse({
    schemaVersion: "0.1.0",
    volumes: [
      {
        id: "v1",
        title: "第一卷",
        chapters: Array.from({ length: 5 }, (_, index) =>
          ChapterPlanSchema.parse({
            id: `c${index + 1}`,
            number: index + 1,
            title: `章节${index + 1}`,
            file: `${index + 1}.md`,
            characters: index === 0 ? ["旧名"] : [],
            characterIds: index === 0 ? ["a"] : undefined,
            archived: index === 4
          })
        )
      }
    ]
  }),
  characters: [
    CharacterSchema.parse({ id: "a", name: "林舟", aliases: ["Ann", "A+B"] }),
    CharacterSchema.parse({ id: "b", name: "旧名", aliases: [] })
  ],
  clues: [],
  conflicts: [],
  timeline: [],
  threads: [],
  scenes: {}
});

describe("whole book matrix", () => {
  it("uses stable IDs, excludes archives and distinguishes mentions from scene references", () => {
    const input = fixture();
    input.scenes.c3 = [
      ScenePlanSchema.parse({
        id: "s1",
        chapterId: "c3",
        order: 0,
        title: "港口",
        requiredCharacters: ["a"],
        povCharacterId: "b"
      })
    ];
    input.texts = { c2: "Hannah met Ann and A+B. 林舟回到了港口。", c5: "林舟" };
    const rows = buildStoryMatrix(input, "characters");
    expect(rows[0].cells.c1[0].kind).toBe("plan");
    expect(rows[1].cells.c1).toBeUndefined();
    expect(rows[0].cells.c2[0].kind).toBe("mention");
    expect(rows[0].cells.c2[0].detail).toContain("3 次");
    expect(rows[0].cells.c3[0].kind).toBe("scene");
    expect(rows[0].cells.c5).toBeUndefined();
    expect(rows[0].chapterCount).toBe(3);
    expect(rows[0].longestGap).toBe(1);
  });

  it("does not silently attribute an ambiguous legacy alias to either character", () => {
    const input = fixture();
    input.characters[0].aliases = ["船长"];
    input.characters[1].aliases = ["船长"];
    input.outline.volumes[0].chapters[1].characters = ["船长"];
    input.texts = { c2: "船长下令起航。" };
    expect(buildStoryMatrix(input, "characters").every((row) => !row.cells.c2)).toBe(true);
  });

  it("supports several POVs in one chapter and exposes missing or invalid scene POVs", () => {
    const input = fixture();
    input.scenes.c1 = [
      ScenePlanSchema.parse({ id: "s1", chapterId: "c1", order: 0, title: "港口", povCharacterId: "a" }),
      ScenePlanSchema.parse({ id: "s2", chapterId: "c1", order: 1, title: "城中", povCharacterId: "b" }),
      ScenePlanSchema.parse({ id: "s3", chapterId: "c1", order: 2, title: "旧场景", povCharacterId: "deleted" })
    ];
    input.failedSceneChapterIds = ["c2"];
    const rows = buildStoryMatrix(input, "pov");
    expect(rows[0].cells.c1).toHaveLength(1);
    expect(rows[1].cells.c1).toHaveLength(1);
    expect(rows.at(-1)?.cells.c1[0].detail).toContain("失效视角");
    expect(rows.at(-1)?.cells.c2[0].detail).toContain("读取失败");
    expect(rows.at(-1)?.cells.c3[0].detail).toBe("没有场景视角记录");
  });

  it("combines plot evidence and legacy conflict/clue links without duplicating migrated clues or inventing payoffs", () => {
    const input = fixture();
    input.clues = [ClueSchema.parse({ id: "q1", title: "信物", plantedChapterId: "c1", status: "resolved" })];
    input.conflicts = [ConflictSchema.parse({ id: "f1", title: "夺位", chapterIds: ["c1", "c3", "c5"] })];
    input.threads = [
      StoryThreadSchema.parse({
        id: "t1",
        title: "信物",
        legacyClueId: "q1",
        setupRefs: [{ chapterId: "c1", startOffset: 0, endOffset: 2, excerpt: "信物", contentHash: "h" }],
        earliestPayoffChapter: 2,
        latestPayoffChapter: 3
      })
    ];
    const rows = buildStoryMatrix(input, "threads");
    expect(rows.map((row) => row.id)).toEqual(["thread:t1", "conflict:f1"]);
    expect(rows[0].cells.c1[0].kind).toBe("setup");
    expect(rows[0].cells.c2[0].kind).toBe("window");
    expect(rows[0].chapterCount).toBe(1);
    expect(rows[0].longestGap).toBe(3);
    expect(rows.every((row) => !row.cells.c5)).toBe(true);
    input.threads = [];
    expect(buildStoryMatrix(input, "threads")[0].cells.c1[0].kind).toBe("setup");
  });

  it("exports CSV with BOM, quoted titles and spreadsheet formula protection", () => {
    const input = fixture();
    input.characters[0].name = '=HYPERLINK("example")';
    const csv = matrixCsv(matrixChapters(input.outline), buildStoryMatrix(input, "characters"));
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"\'=HYPERLINK(""example"")"');
    expect(csv).not.toContain("章节5");
    expect(csv).toContain("规划");
  });
  it("retains distinct source excerpts for the same thread phase in one chapter", () => {
    const input = fixture();
    input.threads = [
      StoryThreadSchema.parse({
        id: "t",
        title: "信物线",
        setupRefs: [
          { chapterId: "c1", startOffset: 0, endOffset: 2, excerpt: "信物", contentHash: "h" },
          { chapterId: "c1", startOffset: 20, endOffset: 24, excerpt: "旧日来信", contentHash: "h" }
        ]
      })
    ];
    const row = buildStoryMatrix(input, "threads")[0];
    expect(row.cells.c1.map((item) => item.excerpt)).toEqual(["信物", "旧日来信"]);
    expect(row.chapterCount).toBe(1);
  });
});
