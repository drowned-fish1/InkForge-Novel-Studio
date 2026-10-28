import type {
  ChapterPlan,
  ChapterRelease,
  DailyWritingPlan,
  DailyWritingTemplate,
  WritingSessionRecord
} from "@inkforge/schemas";

export const dailyTemplates: DailyWritingTemplate[] = [
  {
    id: "daily-standard",
    name: "日更一章",
    wordGoal: 3000,
    minuteGoal: 90,
    releaseWords: 3000,
    tasks: ["确认本章目标与结尾钩子", "完成正文", "复查人物与伏笔"]
  },
  {
    id: "daily-double",
    name: "双更冲刺",
    wordGoal: 6000,
    minuteGoal: 180,
    releaseWords: 6000,
    tasks: ["规划两章场景", "完成两章正文", "检查衔接并整理存稿"]
  },
  {
    id: "daily-light",
    name: "轻量写作",
    wordGoal: 1000,
    minuteGoal: 30,
    releaseWords: 0,
    tasks: ["写完一个场景", "记录下一步灵感"]
  }
];

export const localDayKey = (value: string | number | Date = new Date()): string => {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

export const addCalendarDays = (day: string, count: number): string => {
  const [year, month, date] = day.split("-").map(Number);
  return localDayKey(new Date(year, month - 1, date + count, 12));
};

export const makeDailyPlan = (
  date: string,
  template: DailyWritingTemplate,
  previous?: DailyWritingPlan
): DailyWritingPlan => ({
  date,
  templateId: template.id,
  wordGoal: template.wordGoal,
  minuteGoal: template.minuteGoal,
  releaseWords: template.releaseWords,
  tasks: template.tasks.map((text) => ({
    text,
    done: previous?.tasks.find((task) => task.text === text)?.done ?? false
  }))
});

export const dailyProgress = (sessions: WritingSessionRecord[], date: string) => {
  const records = sessions.filter((session) => localDayKey(session.startedAt) === date);
  // Net growth avoids double-counting passages deleted and retyped during revision.
  return {
    words: Math.max(
      0,
      records.reduce((total, session) => total + session.wordsAdded, 0)
    ),
    minutes: Math.floor(records.reduce((total, session) => total + session.durationSeconds, 0) / 60)
  };
};

export const releaseStatus = (chapter: ChapterPlan, record?: ChapterRelease): ChapterRelease["status"] =>
  record?.status ?? (chapter.status === "done" && chapter.actualWords > 0 ? "ready" : "draft");

export const manuscriptStock = (chapters: ChapterPlan[], releases: ChapterRelease[], releaseWords: number) => {
  const byId = new Map(releases.map((record) => [record.chapterId, record]));
  const active = chapters.filter((chapter) => !chapter.archived);
  const stock = active.filter((chapter) => {
    const status = releaseStatus(chapter, byId.get(chapter.id));
    return chapter.actualWords > 0 && (status === "ready" || status === "scheduled");
  });
  const published = active.filter((chapter) => releaseStatus(chapter, byId.get(chapter.id)) === "published");
  const words = stock.reduce((total, chapter) => total + chapter.actualWords, 0);
  return {
    chapters: stock.length,
    words,
    published: published.length,
    days: releaseWords > 0 ? Math.floor(words / releaseWords) : undefined
  };
};

export const estimateFinishDate = (today: string, target: number, written: number, wordGoal: number) =>
  addCalendarDays(today, Math.max(0, Math.ceil((target - written) / Math.max(1, wordGoal)) - 1));
