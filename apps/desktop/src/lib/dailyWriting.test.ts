import { describe, expect, it } from "vitest";
import {
  ChapterPlanSchema,
  ChapterReleaseSchema,
  DailyWritingTemplateSchema,
  WritingWorkspaceSchema,
  type WritingSessionRecord
} from "@inkforge/schemas";
import {
  addCalendarDays,
  dailyProgress,
  dailyTemplates,
  estimateFinishDate,
  localDayKey,
  makeDailyPlan,
  manuscriptStock
} from "./dailyWriting";

describe("daily writing plans and manuscript stock", () => {
  it("reads an old workspace without requiring a migration", () => {
    expect(
      WritingWorkspaceSchema.parse({ annotations: [], sessions: [], bookmarks: [], fragments: [] }).dailyWriting
    ).toBeUndefined();
    dailyTemplates.forEach((template) => expect(DailyWritingTemplateSchema.safeParse(template).success).toBe(true));
  });
  it("applies templates without losing completed matching tasks", () => {
    const previous = makeDailyPlan("2026-10-12", dailyTemplates[0]);
    previous.tasks[0].done = true;
    const next = makeDailyPlan(
      "2026-10-12",
      { ...dailyTemplates[0], tasks: [previous.tasks[0].text, "检查对白"] },
      previous
    );
    expect(next.tasks).toEqual([
      { text: previous.tasks[0].text, done: true },
      { text: "检查对白", done: false }
    ]);
    expect(makeDailyPlan("2026-10-13", dailyTemplates[0]).tasks.every((task) => !task.done)).toBe(true);
  });
  it("counts daily net growth, clamping a negative day, and isolates days", () => {
    const stamp = (day: number) => new Date(2026, 9, day, 10).toISOString();
    const session = (day: number, words: number, seconds = 120): WritingSessionRecord => ({
      id: `${day}-${words}`,
      chapterId: "c1",
      startedAt: stamp(day),
      endedAt: stamp(day),
      wordsAdded: words,
      durationSeconds: seconds
    });
    const records = [session(12, 1000), session(12, -200), session(13, 500), session(14, -800)];
    expect(dailyProgress(records, "2026-10-12")).toEqual({ words: 800, minutes: 4 });
    expect(dailyProgress(records, "2026-10-14").words).toBe(0);
    expect(localDayKey(stamp(12))).toBe("2026-10-12");
  });
  it("handles leap years, year rollover and completion within today", () => {
    expect(addCalendarDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addCalendarDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(estimateFinishDate("2026-10-12", 10000, 7000, 3000)).toBe("2026-10-12");
    expect(estimateFinishDate("2026-10-12", 10000, 1000, 3000)).toBe("2026-10-14");
    expect(estimateFinishDate("2026-10-12", 10000, 12000, 3000)).toBe("2026-10-12");
  });
  it("excludes published, archived and empty chapters, respecting manual draft overrides", () => {
    const chapter = (id: string, actualWords: number, extra = {}) =>
      ChapterPlanSchema.parse({ id, title: id, number: 1, file: `${id}.md`, actualWords, status: "done", ...extra });
    const chapters = [
      chapter("ready", 3200),
      chapter("scheduled", 3000),
      chapter("published", 5000),
      chapter("archived", 20000, { archived: true }),
      chapter("empty", 0),
      chapter("manual-draft", 3500)
    ];
    const releases = [
      ChapterReleaseSchema.parse({
        chapterId: "scheduled",
        status: "scheduled",
        scheduledDate: "2026-10-13",
        updatedAt: "now"
      }),
      ChapterReleaseSchema.parse({
        chapterId: "published",
        status: "published",
        publishedDate: "2026-10-11",
        updatedAt: "now"
      }),
      ChapterReleaseSchema.parse({ chapterId: "manual-draft", status: "draft", updatedAt: "now" }),
      ChapterReleaseSchema.parse({ chapterId: "deleted", status: "ready", updatedAt: "now" })
    ];
    expect(manuscriptStock(chapters, releases, 3000)).toEqual({ chapters: 2, words: 6200, published: 1, days: 2 });
    expect(manuscriptStock(chapters, releases, 0).days).toBeUndefined();
  });
  it("rejects impossible dates and incomplete release records", () => {
    expect(ChapterReleaseSchema.safeParse({ chapterId: "c", status: "scheduled", updatedAt: "now" }).success).toBe(
      false
    );
    expect(
      ChapterReleaseSchema.safeParse({
        chapterId: "c",
        status: "published",
        publishedDate: "2026-02-30",
        updatedAt: "now"
      }).success
    ).toBe(false);
    expect(DailyWritingTemplateSchema.safeParse({ ...dailyTemplates[0], wordGoal: 0 }).success).toBe(false);
  });
});
