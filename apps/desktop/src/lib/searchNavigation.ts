import type { ProjectSearchResult } from "@/types/app";

export const searchModuleByKind: Record<ProjectSearchResult["kind"], string> = {
  chapter: "chapters",
  character: "characters",
  world: "world",
  location: "locations",
  faction: "factions",
  conflict: "conflicts",
  clue: "clues",
  term: "terms",
  event: "events"
};

export const findSearchSelection = (
  content: string,
  query: string,
  near = 0
): { start: number; end: number } | undefined => {
  const keyword = query.trim().toLocaleLowerCase("zh-CN");
  if (!keyword) return;
  const text = content.toLocaleLowerCase("zh-CN");
  let match = text.indexOf(keyword);
  let nearest = -1;
  while (match >= 0) {
    if (nearest < 0 || Math.abs(match - near) < Math.abs(nearest - near)) nearest = match;
    match = text.indexOf(keyword, match + Math.max(keyword.length, 1));
  }
  return nearest >= 0 ? { start: nearest, end: nearest + query.trim().length } : undefined;
};
