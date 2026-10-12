import type { Character, ChapterPlan, Clue, Conflict, Term, TimelineEvent, WorldEntry } from "@inkforge/schemas";
import type { ProjectSearchResult } from "../types.js";

export const buildSearchSnippet = (content: string, offset: number, length: number): string => {
  const start = Math.max(0, offset - 36);
  const end = Math.min(content.length, offset + length + 36);
  return `${start > 0 ? "…" : ""}${content.slice(start, end).replace(/\s+/gu, " ")}${end < content.length ? "…" : ""}`;
};

export const searchChapterContent = (
  chapter: ChapterPlan,
  volumeTitle: string,
  content: string,
  rawQuery: string
): ProjectSearchResult[] => {
  const query = rawQuery.trim();
  if (!query || chapter.archived) return [];
  const lower = query.toLocaleLowerCase("zh-CN");
  const body = content.toLocaleLowerCase("zh-CN");
  const results: ProjectSearchResult[] = [];
  let offset = body.indexOf(lower);
  while (offset >= 0 && results.length < 3) {
    results.push({
      kind: "chapter",
      id: chapter.id,
      title: chapter.title,
      volumeTitle,
      offset,
      matchLength: query.length,
      snippet: buildSearchSnippet(content, offset, query.length)
    });
    offset = body.indexOf(lower, offset + Math.max(query.length, 1));
  }
  if (!results.length && chapter.title.toLocaleLowerCase("zh-CN").includes(lower)) {
    results.push({
      kind: "chapter",
      id: chapter.id,
      title: chapter.title,
      volumeTitle,
      offset: 0,
      matchLength: 0,
      snippet: "章节标题匹配"
    });
  }
  return results;
};

interface SearchEntries {
  characters: Character[];
  world: WorldEntry[];
  conflicts: Conflict[];
  clues: Clue[];
  terms: Term[];
  timeline: TimelineEvent[];
}

// Browser preview and desktop search use the same fields and match-centred excerpts.
export const searchStoryEntries = (data: SearchEntries, rawQuery: string, limit = 60): ProjectSearchResult[] => {
  const query = rawQuery.trim();
  if (!query) return [];
  const lower = query.toLocaleLowerCase("zh-CN");
  const results: ProjectSearchResult[] = [];
  const add = (kind: ProjectSearchResult["kind"], id: string, title: string, fields: string[]) => {
    if (results.length >= limit) return;
    const content = fields.find((field) => field.toLocaleLowerCase("zh-CN").includes(lower));
    if (content !== undefined || title.toLocaleLowerCase("zh-CN").includes(lower)) {
      results.push({
        kind,
        id,
        title,
        offset: 0,
        matchLength: 0,
        snippet:
          content === undefined
            ? "名称匹配"
            : buildSearchSnippet(content, content.toLocaleLowerCase("zh-CN").indexOf(lower), query.length)
      });
    }
  };
  for (const item of data.characters)
    add("character", item.id, item.name, [
      ...item.aliases,
      ...item.tags,
      ...Object.values(item.profile),
      item.currentState.arc,
      item.currentState.powerLevel,
      item.currentState.location,
      ...item.currentState.relationships,
      ...item.currentState.secrets,
      item.voiceNotes
    ]);
  for (const item of data.world)
    add(
      item.type === "location" ? "location" : ["faction", "organization"].includes(item.type) ? "faction" : "world",
      item.id,
      item.title,
      [item.summary, item.content, ...item.tags, ...item.relatedCharacters, ...item.relatedClues]
    );
  for (const item of data.conflicts)
    add("conflict", item.id, item.title, [
      item.summary,
      item.stakes,
      item.notes,
      ...item.parties,
      ...item.relatedCharacters,
      ...item.relatedFactions
    ]);
  for (const item of data.clues)
    add("clue", item.id, item.title, [item.notes, item.expectedPayoff, ...item.relatedCharacters]);
  for (const item of data.terms) add("term", item.id, item.name, [item.definition, ...item.aliases]);
  for (const item of data.timeline)
    add("event", item.id, item.title, [item.summary, item.location, ...item.participants]);
  return results;
};
