import { describe, expect, it } from "vitest";
import {
  CharacterSchema,
  ChapterPlanSchema,
  ClueSchema,
  ConflictSchema,
  TermSchema,
  TimelineEventSchema,
  WorldEntrySchema
} from "@inkforge/schemas";
import { searchChapterContent, searchStoryEntries } from "./ProjectSearchEntries.js";

describe("desktop and preview search fields", () => {
  const data = {
    characters: [CharacterSchema.parse({ id: "char", name: "人物", voiceNotes: "前置内容。声音线索。" })],
    world: [WorldEntrySchema.parse({ id: "world", title: "世界", content: "正文线索" })],
    conflicts: [ConflictSchema.parse({ id: "conflict", title: "冲突", stakes: "后果线索" })],
    clues: [ClueSchema.parse({ id: "clue", title: "伏笔", expectedPayoff: `${"铺垫".repeat(70)}回收线索` })],
    terms: [TermSchema.parse({ id: "term", name: "术语", aliases: ["别名线索"] })],
    timeline: [TimelineEventSchema.parse({ id: "event", title: "事件", order: 1, participants: ["人物线索"] })]
  };
  it("finds fields outside names and excerpts the actual match even after long prefixes", () => {
    const results = searchStoryEntries(data, "线索");
    expect(results.map((result) => result.kind)).toEqual(["character", "world", "conflict", "clue", "term", "event"]);
    expect(results.every((result) => result.snippet.includes("线索"))).toBe(true);
    expect(results.find((result) => result.kind === "clue")?.snippet.startsWith("…")).toBe(true);
  });
  it("limits results and does not search blank input", () => {
    expect(searchStoryEntries(data, "线索", 2)).toHaveLength(2);
    expect(searchStoryEntries(data, "线索", 0)).toEqual([]);
    expect(searchStoryEntries(data, "  ")).toEqual([]);
  });
  it("returns separate chapter occurrences and skips archived chapters", () => {
    const chapter = ChapterPlanSchema.parse({ id: "chapter", number: 1, title: "第一章", file: "chapter.md" });
    expect(
      searchChapterContent(chapter, "第一卷", "车票。车票。车票。车票。", "车票").map((result) => result.offset)
    ).toEqual([0, 3, 6]);
    expect(searchChapterContent({ ...chapter, archived: true }, "第一卷", "车票", "车票")).toEqual([]);
  });
});
