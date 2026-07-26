import { describe, expect, it } from "vitest";
import {
  ChapterPlanSchema,
  CharacterSchema,
  ClueSchema,
  ConflictSchema,
  TimelineEventSchema,
  WorldEntrySchema,
  detachStoryReferences,
  findStoryReferences,
  type StoryReferenceData
} from "../src/index";

const buildData = (): StoryReferenceData => ({
  characters: [
    CharacterSchema.parse({
      id: "char-lin",
      name: "林烬",
      aliases: ["小林"],
      currentState: { relationships: ["林烬的宿敌是赵五", "与苏禾结盟"], location: "旧车站" }
    }),
    CharacterSchema.parse({
      id: "char-su",
      name: "苏禾",
      currentState: { relationships: ["信任林烬"], location: "" }
    })
  ],
  worldEntries: [
    WorldEntrySchema.parse({
      id: "loc-station",
      title: "旧车站",
      type: "location",
      relatedCharacters: ["林烬"],
      relatedClues: ["褪色车票"]
    }),
    WorldEntrySchema.parse({ id: "fac-guild", title: "缉私队", type: "faction", relatedCharacters: ["苏禾"] })
  ],
  timeline: [
    TimelineEventSchema.parse({
      id: "ev-1",
      order: 1,
      title: "车站接头",
      location: "旧车站",
      participants: ["林烬", "苏禾"]
    })
  ],
  clues: [ClueSchema.parse({ id: "clue-ticket", title: "褪色车票", relatedCharacters: ["林烬"] })],
  terms: [],
  conflicts: [
    ConflictSchema.parse({
      id: "conf-1",
      title: "车票争夺",
      parties: ["林烬", "缉私队"],
      relatedCharacters: ["林烬"],
      relatedFactions: ["缉私队"],
      chapterIds: ["ch-0001"]
    })
  ],
  chapters: [
    ChapterPlanSchema.parse({
      id: "ch-0001",
      number: 1,
      title: "第1章",
      file: "chapters/volume-001/ch-0001.md",
      characters: ["林烬"],
      worldRefs: ["旧车站"]
    })
  ]
});

describe("findStoryReferences", () => {
  it("finds character references across every entity family including aliases", () => {
    const hits = findStoryReferences(buildData(), { kind: "character", id: "char-lin" });
    const kinds = hits.map((hit) => `${hit.sourceKind}:${hit.field}`);
    expect(kinds).toContain("character:人物关系");
    expect(kinds).toContain("world:关联人物");
    expect(kinds).toContain("timeline:参与者");
    expect(kinds).toContain("clue:涉及人物");
    expect(kinds).toContain("conflict:冲突各方");
    expect(kinds).toContain("chapter:章节出场人物");
  });

  it("finds location references including scalar location fields", () => {
    const hits = findStoryReferences(buildData(), { kind: "world", id: "loc-station" });
    const kinds = hits.map((hit) => `${hit.sourceKind}:${hit.field}`);
    expect(kinds).toContain("character:当前位置");
    expect(kinds).toContain("timeline:发生地点");
    expect(kinds).toContain("chapter:章节世界观引用");
  });

  it("returns empty for entities without references", () => {
    const data = buildData();
    data.conflicts.push(ConflictSchema.parse({ id: "conf-lonely", title: "孤立冲突" }));
    expect(findStoryReferences(data, { kind: "conflict", id: "conf-lonely" })).toEqual([]);
  });
});

describe("detachStoryReferences", () => {
  it("unlinks a character from every referencing field", () => {
    const result = detachStoryReferences(buildData(), { kind: "character", id: "char-lin" }, "unlink");
    expect(result.characters.find((item) => item.id === "char-su")?.currentState.relationships).toEqual([]);
    expect(result.worldEntries.find((item) => item.id === "loc-station")?.relatedCharacters).toEqual([]);
    expect(result.timeline[0].participants).toEqual(["苏禾"]);
    expect(result.clues[0].relatedCharacters).toEqual([]);
    expect(result.conflicts[0].parties).toEqual(["缉私队"]);
    expect(result.chapters[0].characters).toEqual([]);
    expect(result.chaptersChanged).toBe(true);
    // The deleted character's own record is untouched.
    expect(result.characters.find((item) => item.id === "char-lin")?.currentState.relationships).toHaveLength(2);
  });

  it("replaces references with a new name without duplicating", () => {
    const result = detachStoryReferences(buildData(), { kind: "character", id: "char-lin" }, "replace", "陆离");
    expect(result.timeline[0].participants).toEqual(["陆离", "苏禾"]);
    expect(result.conflicts[0].parties).toEqual(["陆离", "缉私队"]);
    expect(result.chapters[0].characters).toEqual(["陆离"]);
    const suHe = result.characters.find((item) => item.id === "char-su");
    expect(suHe?.currentState.relationships).toEqual(["信任陆离"]);
  });

  it("clears location scalar fields on unlink for world targets only", () => {
    const result = detachStoryReferences(buildData(), { kind: "world", id: "loc-station" }, "unlink");
    expect(result.characters.find((item) => item.id === "char-lin")?.currentState.location).toBe("");
    expect(result.timeline[0].location).toBe("");
    expect(result.chapters[0].worldRefs).toEqual([]);
  });
});

describe("ConflictSchema", () => {
  it("applies defaults for a minimal conflict", () => {
    const conflict = ConflictSchema.parse({ id: "conf-min", title: "最小冲突" });
    expect(conflict.kind).toBe("sub");
    expect(conflict.status).toBe("planned");
    expect(conflict.parties).toEqual([]);
    expect(conflict.chapterIds).toEqual([]);
  });
});
