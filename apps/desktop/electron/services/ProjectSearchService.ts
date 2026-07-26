import type { ProjectSearchResult } from "../types.js";
import { FileRepository } from "./FileRepository.js";
import { LibraryService } from "./LibraryService.js";
import { ProjectService } from "./ProjectService.js";
import { StoryStateService } from "./StoryStateService.js";

const maxResults = 60;
const maxMatchesPerChapter = 3;
const snippetRadius = 36;

/** Full-text search across chapter contents plus entity names/summaries. */
export class ProjectSearchService {
  constructor(
    private readonly files = new FileRepository(),
    private readonly projects = new ProjectService(files),
    private readonly library = new LibraryService(files),
    private readonly story = new StoryStateService(files, projects)
  ) {}

  async search(projectPath: string, rawQuery: string): Promise<ProjectSearchResult[]> {
    const query = rawQuery.trim();
    if (query.length < 1) {
      return [];
    }
    const lowerQuery = query.toLocaleLowerCase("zh-CN");
    const results: ProjectSearchResult[] = [];
    const project = await this.projects.openProject(projectPath);

    for (const volume of project.outline.volumes) {
      for (const chapter of volume.chapters) {
        if (chapter.archived || results.length >= maxResults) {
          continue;
        }
        const content = await this.files
          .readText(this.files.assertInsideProject(projectPath, chapter.file))
          .catch(() => "");
        const lowerContent = content.toLocaleLowerCase("zh-CN");
        let cursor = lowerContent.indexOf(lowerQuery);
        let found = 0;
        while (cursor >= 0 && found < maxMatchesPerChapter && results.length < maxResults) {
          results.push({
            kind: "chapter",
            id: chapter.id,
            title: chapter.title,
            volumeTitle: volume.title,
            offset: cursor,
            matchLength: query.length,
            snippet: buildSnippet(content, cursor, query.length)
          });
          found += 1;
          cursor = lowerContent.indexOf(lowerQuery, cursor + Math.max(1, query.length));
        }
        if (!found && chapter.title.toLocaleLowerCase("zh-CN").includes(lowerQuery) && results.length < maxResults) {
          results.push({
            kind: "chapter",
            id: chapter.id,
            title: chapter.title,
            volumeTitle: volume.title,
            offset: 0,
            matchLength: 0,
            snippet: "章节标题匹配"
          });
        }
      }
    }

    const [characters, world, conflicts, clues, terms, timeline] = await Promise.all([
      this.library.listCharacters(projectPath),
      this.library.listWorldEntries(projectPath),
      this.story.listConflicts(projectPath),
      this.story.listClues(projectPath),
      this.story.listTerms(projectPath),
      this.story.listTimeline(projectPath)
    ]);
    const pushEntity = (
      kind: ProjectSearchResult["kind"],
      id: string,
      title: string,
      haystack: string,
      snippetSource: string
    ) => {
      if (results.length >= maxResults) {
        return;
      }
      if (haystack.toLocaleLowerCase("zh-CN").includes(lowerQuery)) {
        results.push({ kind, id, title, snippet: snippetSource.slice(0, 90), offset: 0, matchLength: 0 });
      }
    };
    for (const item of characters) {
      pushEntity(
        "character",
        item.id,
        item.name,
        `${item.name} ${item.aliases.join(" ")} ${item.profile.identity}`,
        item.profile.identity || item.currentState.arc
      );
    }
    for (const item of world) {
      const kind =
        item.type === "location"
          ? "location"
          : item.type === "faction" || item.type === "organization"
            ? "faction"
            : "world";
      pushEntity(kind, item.id, item.title, `${item.title} ${item.summary} ${item.tags.join(" ")}`, item.summary);
    }
    for (const item of conflicts) {
      pushEntity(
        "conflict",
        item.id,
        item.title,
        `${item.title} ${item.summary} ${item.parties.join(" ")}`,
        item.summary || item.stakes
      );
    }
    for (const item of clues) {
      pushEntity("clue", item.id, item.title, `${item.title} ${item.notes}`, item.expectedPayoff);
    }
    for (const item of terms) {
      pushEntity(
        "term",
        item.id,
        item.name,
        `${item.name} ${item.aliases.join(" ")} ${item.definition}`,
        item.definition
      );
    }
    for (const item of timeline) {
      pushEntity(
        "event",
        item.id,
        item.title,
        `${item.title} ${item.summary} ${item.participants.join(" ")}`,
        item.summary
      );
    }

    return results;
  }
}

const buildSnippet = (content: string, offset: number, length: number): string => {
  const start = Math.max(0, offset - snippetRadius);
  const end = Math.min(content.length, offset + length + snippetRadius);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < content.length ? "…" : "";
  return `${prefix}${content.slice(start, end).replace(/\s+/gu, " ")}${suffix}`;
};
