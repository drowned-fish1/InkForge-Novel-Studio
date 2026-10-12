import type { ChapterPlan, Outline } from "@inkforge/schemas";

interface ChapterPosition {
  anchor: number;
  head: number;
  scrollTop: number;
}

interface WritingContinuity {
  lastChapterId?: string;
  positions: Record<string, ChapterPosition>;
}

const storageKey = (projectPath: string) => `inkforge:writing-continuity:v1:${projectPath}`;
const readContinuity = (projectPath: string): WritingContinuity => {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey(projectPath)) ?? "null");
    return {
      lastChapterId: typeof stored?.lastChapterId === "string" ? stored.lastChapterId : undefined,
      positions: stored?.positions && typeof stored.positions === "object" ? stored.positions : {}
    };
  } catch {
    return { positions: {} };
  }
};

const writeContinuity = (projectPath: string, value: WritingContinuity) => {
  try {
    localStorage.setItem(storageKey(projectPath), JSON.stringify(value));
  } catch {
    /* Reading preferences must not interrupt writing. */
  }
};

export const rememberWritingChapter = (projectPath: string, chapterId: string) =>
  writeContinuity(projectPath, { ...readContinuity(projectPath), lastChapterId: chapterId });

export const chapterToResume = (projectPath: string, outline: Outline): ChapterPlan | undefined => {
  const chapters = outline.volumes.flatMap((volume) => volume.chapters).filter((chapter) => !chapter.archived);
  const last = readContinuity(projectPath).lastChapterId;
  return chapters.find((chapter) => chapter.id === last) ?? chapters[0];
};

export const readChapterPosition = (projectPath: string, chapterId: string): ChapterPosition | undefined => {
  const position = readContinuity(projectPath).positions[chapterId];
  return position &&
    [position.anchor, position.head, position.scrollTop].every((number) => Number.isFinite(number) && number >= 0)
    ? position
    : undefined;
};

export const rememberChapterPosition = (projectPath: string, chapterId: string, position: ChapterPosition) => {
  const stored = readContinuity(projectPath);
  // Store only navigation preferences; manuscript and undo content remain outside localStorage.
  const entries = Object.entries(stored.positions)
    .filter(([id]) => id !== chapterId)
    .slice(-199);
  writeContinuity(projectPath, { ...stored, positions: Object.fromEntries([...entries, [chapterId, position]]) });
};
