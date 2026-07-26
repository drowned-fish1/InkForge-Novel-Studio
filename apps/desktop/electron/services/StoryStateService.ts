import {
  ClueSchema,
  ConflictSchema,
  TermSchema,
  TimelineEventSchema,
  type Clue,
  type Conflict,
  type Term,
  type TimelineEvent
} from "@inkforge/schemas";
import type { ConsistencyIssue } from "../types.js";
import { FileRepository } from "./FileRepository.js";
import { LibraryService } from "./LibraryService.js";
import { ProjectService } from "./ProjectService.js";

export class StoryStateService {
  constructor(
    private readonly files = new FileRepository(),
    private readonly projects = new ProjectService(files),
    private readonly library = new LibraryService(files)
  ) {}

  async listConflicts(projectPath: string): Promise<Conflict[]> {
    const items = await this.readArray(projectPath, "conflicts.json", ConflictSchema);
    return items.sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
  }

  async saveConflict(projectPath: string, conflict: Conflict): Promise<Conflict[]> {
    const parsed = ConflictSchema.parse(conflict);
    const items = await this.listConflicts(projectPath);
    const next = upsertById(items, parsed);
    await this.files.writeJsonAtomic(this.files.assertInsideProject(projectPath, "conflicts.json"), next);
    return next;
  }

  async deleteConflict(projectPath: string, conflictId: string): Promise<Conflict[]> {
    const next = (await this.listConflicts(projectPath)).filter((item) => item.id !== conflictId);
    await this.files.writeJsonAtomic(this.files.assertInsideProject(projectPath, "conflicts.json"), next);
    return next;
  }

  async deleteTimelineEvent(projectPath: string, eventId: string): Promise<TimelineEvent[]> {
    const next = (await this.listTimeline(projectPath)).filter((item) => item.id !== eventId);
    await this.files.writeJsonAtomic(this.files.assertInsideProject(projectPath, "timeline.json"), next);
    return next;
  }

  async deleteClue(projectPath: string, clueId: string): Promise<Clue[]> {
    const next = (await this.listClues(projectPath)).filter((item) => item.id !== clueId);
    await this.files.writeJsonAtomic(this.files.assertInsideProject(projectPath, "clues.json"), next);
    return next;
  }

  async deleteTerm(projectPath: string, termId: string): Promise<Term[]> {
    const next = (await this.listTerms(projectPath)).filter((item) => item.id !== termId);
    await this.files.writeJsonAtomic(this.files.assertInsideProject(projectPath, "terms.json"), next);
    return next;
  }

  async listTimeline(projectPath: string): Promise<TimelineEvent[]> {
    const items = await this.readArray(projectPath, "timeline.json", TimelineEventSchema);
    return items.sort((a, b) => a.order - b.order);
  }

  async saveTimelineEvent(projectPath: string, event: TimelineEvent): Promise<TimelineEvent[]> {
    const parsed = TimelineEventSchema.parse(event);
    const items = await this.listTimeline(projectPath);
    const next = upsertById(items, parsed);
    await this.files.writeJsonAtomic(this.files.assertInsideProject(projectPath, "timeline.json"), next);
    return next;
  }

  async listClues(projectPath: string): Promise<Clue[]> {
    const items = await this.readArray(projectPath, "clues.json", ClueSchema);
    return items.sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
  }

  async saveClue(projectPath: string, clue: Clue): Promise<Clue[]> {
    const parsed = ClueSchema.parse(clue);
    const items = await this.listClues(projectPath);
    const next = upsertById(items, parsed);
    await this.files.writeJsonAtomic(this.files.assertInsideProject(projectPath, "clues.json"), next);
    return next;
  }

  async listTerms(projectPath: string): Promise<Term[]> {
    const items = await this.readArray(projectPath, "terms.json", TermSchema);
    return items.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  }

  async saveTerm(projectPath: string, term: Term): Promise<Term[]> {
    const parsed = TermSchema.parse(term);
    const items = await this.listTerms(projectPath);
    const next = upsertById(items, parsed);
    await this.files.writeJsonAtomic(this.files.assertInsideProject(projectPath, "terms.json"), next);
    return next;
  }

  async inspect(projectPath: string): Promise<ConsistencyIssue[]> {
    const project = await this.projects.openProject(projectPath);
    const [timeline, clues, terms, conflicts, characters, worldEntries] = await Promise.all([
      this.listTimeline(projectPath),
      this.listClues(projectPath),
      this.listTerms(projectPath),
      this.listConflicts(projectPath),
      this.library.listCharacters(projectPath),
      this.library.listWorldEntries(projectPath)
    ]);
    const chapters = project.outline.volumes.flatMap((volume) => volume.chapters);
    const chapterIds = new Set(chapters.map((chapter) => chapter.id));
    const issues: ConsistencyIssue[] = [];

    const normalize = (value: string) => value.trim().toLocaleLowerCase("zh-CN");
    const knownCharacterNames = new Set(
      characters.flatMap((character) => [character.name, ...character.aliases]).map(normalize)
    );
    const knownWorldTitles = new Set(worldEntries.map((entry) => normalize(entry.title)));
    const unknownCharacterChapters = new Map<string, string[]>();
    const unknownWorldRefChapters = new Map<string, string[]>();
    for (const chapter of chapters) {
      if (chapter.archived) {
        continue;
      }
      for (const name of chapter.characters) {
        const trimmed = name.trim();
        if (trimmed && !knownCharacterNames.has(normalize(trimmed))) {
          unknownCharacterChapters.set(trimmed, [...(unknownCharacterChapters.get(trimmed) ?? []), chapter.title]);
        }
      }
      for (const ref of chapter.worldRefs) {
        const trimmed = ref.trim();
        if (trimmed && !knownWorldTitles.has(normalize(trimmed))) {
          unknownWorldRefChapters.set(trimmed, [...(unknownWorldRefChapters.get(trimmed) ?? []), chapter.title]);
        }
      }
    }
    for (const [name, titles] of unknownCharacterChapters) {
      issues.push({
        id: `chapter-unknown-character-${name}`,
        severity: "warning",
        scope: "project",
        title: "章节出场人物不在人物库",
        detail: `“${name}”出现在 ${titles.slice(0, 3).join("、")}${titles.length > 3 ? ` 等 ${titles.length} 章` : ""} 的出场名单，但人物库中没有同名或别名条目。改名后请同步章节名单，或补建人物卡。`
      });
    }
    for (const [ref, titles] of unknownWorldRefChapters) {
      issues.push({
        id: `chapter-unknown-worldref-${ref}`,
        severity: "warning",
        scope: "project",
        title: "章节引用的世界观条目不存在",
        detail: `“${ref}”被 ${titles.slice(0, 3).join("、")}${titles.length > 3 ? ` 等 ${titles.length} 章` : ""} 引用，但世界观库中没有同名条目。`
      });
    }
    for (const conflict of conflicts) {
      const dangling = conflict.chapterIds.filter((id) => !chapterIds.has(id));
      if (dangling.length) {
        issues.push({
          id: `conflict-bad-chapter-${conflict.id}`,
          severity: "error",
          scope: "project",
          title: "冲突关联了不存在的章节",
          detail: `${conflict.title} 的 ${dangling.length} 个关联章节（${dangling.slice(0, 3).join("、")}${dangling.length > 3 ? " 等" : ""}）已不在大纲中。`
        });
      }
    }

    for (const event of timeline) {
      if (!event.chapterId) {
        issues.push({
          id: `timeline-missing-chapter-${event.id}`,
          severity: "warning",
          scope: "timeline",
          title: "时间线事件未关联章节",
          detail: `${event.title} 没有 chapterId，后续上下文构建可能漏掉它。`
        });
      } else if (!chapterIds.has(event.chapterId)) {
        issues.push({
          id: `timeline-bad-chapter-${event.id}`,
          severity: "error",
          scope: "timeline",
          title: "时间线事件关联了不存在的章节",
          detail: `${event.title} 指向 ${event.chapterId}，但大纲中没有这个章节。`
        });
      }
    }

    for (const clue of clues) {
      if (clue.status !== "resolved" && !clue.expectedPayoff.trim()) {
        issues.push({
          id: `clue-missing-payoff-${clue.id}`,
          severity: "warning",
          scope: "clue",
          title: "伏笔缺少预期回收",
          detail: `${clue.title} 仍未解决，但没有填写 expectedPayoff。`
        });
      }
      if (clue.plantedChapterId && !chapterIds.has(clue.plantedChapterId)) {
        issues.push({
          id: `clue-bad-chapter-${clue.id}`,
          severity: "error",
          scope: "clue",
          title: "伏笔埋设章节不存在",
          detail: `${clue.title} 指向 ${clue.plantedChapterId}，但大纲中没有这个章节。`
        });
      }
    }

    const termNames = new Map<string, string>();
    for (const term of terms) {
      const key = term.name.trim().toLowerCase();
      if (termNames.has(key)) {
        issues.push({
          id: `term-duplicate-${term.id}`,
          severity: "error",
          scope: "term",
          title: "术语重名",
          detail: `${term.name} 与 ${termNames.get(key)} 重名，可能导致一致性检查混淆。`
        });
      }
      termNames.set(key, term.id);
      if (!term.definition.trim()) {
        issues.push({
          id: `term-empty-definition-${term.id}`,
          severity: "info",
          scope: "term",
          title: "术语缺少定义",
          detail: `${term.name} 还没有 definition。`
        });
      }
    }

    if (timeline.length === 0 && clues.length === 0 && terms.length === 0) {
      issues.push({
        id: "project-empty-check-data",
        severity: "info",
        scope: "project",
        title: "检查数据尚未建立",
        detail: "添加时间线、伏笔或术语后，本地检查会更有价值。"
      });
    }

    return issues;
  }

  private async readArray<T>(
    projectPath: string,
    relativeFile: string,
    schema: { parse: (value: unknown) => T }
  ): Promise<T[]> {
    try {
      const raw = await this.files.readJson<unknown[]>(this.files.assertInsideProject(projectPath, relativeFile));
      return raw.map((item) => schema.parse(item));
    } catch {
      return [];
    }
  }
}

const upsertById = <T extends { id: string }>(items: T[], item: T): T[] => {
  const index = items.findIndex((candidate) => candidate.id === item.id);
  if (index < 0) {
    return [...items, item];
  }
  return items.map((candidate, candidateIndex) => (candidateIndex === index ? item : candidate));
};
