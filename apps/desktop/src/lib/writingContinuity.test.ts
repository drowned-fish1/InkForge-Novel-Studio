import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChapterPlanSchema, OutlineSchema } from "@inkforge/schemas";
import {
  chapterToResume,
  readChapterPosition,
  rememberChapterPosition,
  rememberWritingChapter
} from "./writingContinuity";

const values = new Map<string, string>();
const chapter = (id: string, archived = false) =>
  ChapterPlanSchema.parse({ id, title: id, number: 1, file: `${id}.md`, archived });
beforeEach(() => {
  values.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value)
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("continue writing", () => {
  it("resumes the last active chapter and skips archived or deleted chapters", () => {
    const outline = OutlineSchema.parse({
      schemaVersion: "0.1.0",
      volumes: [
        { id: "vol", title: "第一卷", chapters: [chapter("archived", true), chapter("first"), chapter("last")] }
      ]
    });
    rememberWritingChapter("novel-a", "last");
    expect(chapterToResume("novel-a", outline)?.id).toBe("last");
    rememberWritingChapter("novel-a", "archived");
    expect(chapterToResume("novel-a", outline)?.id).toBe("first");
    rememberWritingChapter("novel-a", "deleted");
    expect(chapterToResume("novel-a", outline)?.id).toBe("first");
  });
  it("keeps positions isolated between novels with identical chapter IDs", () => {
    rememberChapterPosition("novel-a", "ch-0001", { anchor: 30, head: 40, scrollTop: 900 });
    expect(readChapterPosition("novel-a", "ch-0001")).toEqual({ anchor: 30, head: 40, scrollTop: 900 });
    expect(readChapterPosition("novel-b", "ch-0001")).toBeUndefined();
    expect([...values.values()].join("")).not.toContain("content");
  });
  it("ignores malformed or unavailable preference storage", () => {
    values.set("inkforge:writing-continuity:v1:a", "broken");
    expect(readChapterPosition("a", "chapter")).toBeUndefined();
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("disabled");
      },
      setItem: () => {
        throw new Error("full");
      }
    });
    expect(() => rememberWritingChapter("a", "chapter")).not.toThrow();
  });
});
