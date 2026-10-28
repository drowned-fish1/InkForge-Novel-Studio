import type { ChapterPlan, Character, Clue, Conflict, Term, TimelineEvent, WorldEntry } from "./index.js";

export type StoryEntityKind = "character" | "world" | "timeline" | "clue" | "term" | "conflict";

export interface StoryEntityRef {
  kind: StoryEntityKind;
  id: string;
}

export interface StoryReferenceHit {
  sourceKind: "character" | "world" | "timeline" | "clue" | "conflict" | "chapter";
  sourceId: string;
  sourceTitle: string;
  field: string;
  matched: string;
}

export type StoryDetachMode = "unlink" | "replace";

export interface StoryReferenceData {
  characters: Character[];
  worldEntries: WorldEntry[];
  timeline: TimelineEvent[];
  clues: Clue[];
  terms: Term[];
  conflicts: Conflict[];
  chapters: ChapterPlan[];
}

export interface StoryDetachResult {
  characters: Character[];
  worldEntries: WorldEntry[];
  timeline: TimelineEvent[];
  clues: Clue[];
  conflicts: Conflict[];
  chapters: ChapterPlan[];
  changedCharacterIds: string[];
  changedWorldIds: string[];
  changedTimelineIds: string[];
  changedClueIds: string[];
  changedConflictIds: string[];
  chaptersChanged: boolean;
}

export interface StoryIdMigrationResult extends StoryReferenceData {
  changedCharacterIds: string[];
  changedWorldIds: string[];
  changedTimelineIds: string[];
  changedClueIds: string[];
  changedConflictIds: string[];
  chaptersChanged: boolean;
  migratedReferenceCount: number;
}

const normalizedName = (value: string): string => value.trim().toLocaleLowerCase("zh-CN");

const unambiguousNameIndex = (entries: Array<{ id: string; names: string[] }>): Map<string, string> => {
  const candidates = new Map<string, Set<string>>();
  for (const entry of entries) {
    for (const name of entry.names) {
      const key = normalizedName(name);
      if (!key) continue;
      const ids = candidates.get(key) ?? new Set<string>();
      ids.add(entry.id);
      candidates.set(key, ids);
    }
  }
  return new Map(
    [...candidates.entries()].filter(([, ids]) => ids.size === 1).map(([name, ids]) => [name, [...ids][0]])
  );
};

const mergeIds = (existing: string[] | undefined, resolved: Array<string | undefined>): string[] => [
  ...new Set([...(existing ?? []), ...resolved.filter((id): id is string => Boolean(id))])
];

/**
 * Add stable-ID mirrors to legacy name-based story references. Display names
 * remain untouched as a rollback path for older application versions. Only
 * unambiguous names are migrated; collisions stay legacy-only for manual
 * resolution instead of risking a reference to the wrong entity.
 */
export const migrateStoryReferencesToIds = (data: StoryReferenceData): StoryIdMigrationResult => {
  const characterNames = unambiguousNameIndex(
    data.characters.map((item) => ({ id: item.id, names: [item.name, ...item.aliases] }))
  );
  const worldNames = unambiguousNameIndex(data.worldEntries.map((item) => ({ id: item.id, names: [item.title] })));
  const clueNames = unambiguousNameIndex(data.clues.map((item) => ({ id: item.id, names: [item.title] })));
  const entityNames = unambiguousNameIndex([
    ...data.characters.map((item) => ({ id: item.id, names: [item.name, ...item.aliases] })),
    ...data.worldEntries.map((item) => ({ id: item.id, names: [item.title] }))
  ]);
  const factionNames = unambiguousNameIndex(
    data.worldEntries
      .filter((item) => item.type === "faction" || item.type === "organization")
      .map((item) => ({ id: item.id, names: [item.title] }))
  );
  let migratedReferenceCount = 0;
  const changedCharacterIds: string[] = [];
  const changedWorldIds: string[] = [];
  const changedTimelineIds: string[] = [];
  const changedClueIds: string[] = [];
  const changedConflictIds: string[] = [];
  let chaptersChanged = false;
  const changed = (before: string[] | undefined, after: string[]): boolean => {
    const old = before ?? [];
    const isChanged = old.length !== after.length || old.some((value, index) => value !== after[index]);
    if (isChanged) migratedReferenceCount += Math.max(0, after.length - old.length);
    return isChanged;
  };

  const characters = data.characters.map((item) => {
    const locationId = item.currentState.locationId || worldNames.get(normalizedName(item.currentState.location)) || "";
    const relationshipCharacterIds = mergeIds(
      item.currentState.relationshipCharacterIds,
      item.currentState.relationships.flatMap((relation) =>
        [...characterNames.entries()]
          .filter(([name]) => name.length >= 2 && normalizedName(relation).includes(name))
          .map(([, id]) => id)
      )
    );
    const locationChanged = Boolean(locationId && locationId !== item.currentState.locationId);
    const relationshipsChanged = changed(item.currentState.relationshipCharacterIds, relationshipCharacterIds);
    if (!locationChanged && !relationshipsChanged) return item;
    if (locationChanged) migratedReferenceCount += 1;
    changedCharacterIds.push(item.id);
    return { ...item, currentState: { ...item.currentState, locationId, relationshipCharacterIds } };
  });

  const worldEntries = data.worldEntries.map((item) => {
    const relatedCharacterIds = mergeIds(
      item.relatedCharacterIds,
      item.relatedCharacters.map((name) => characterNames.get(normalizedName(name)))
    );
    const relatedClueIds = mergeIds(
      item.relatedClueIds,
      item.relatedClues.map((name) => clueNames.get(normalizedName(name)))
    );
    const charactersChanged = changed(item.relatedCharacterIds, relatedCharacterIds);
    const cluesChanged = changed(item.relatedClueIds, relatedClueIds);
    if (!charactersChanged && !cluesChanged) return item;
    changedWorldIds.push(item.id);
    return { ...item, relatedCharacterIds, relatedClueIds };
  });

  const timeline = data.timeline.map((item) => {
    const participantIds = mergeIds(
      item.participantIds,
      item.participants.map((name) => characterNames.get(normalizedName(name)))
    );
    const locationId = item.locationId || worldNames.get(normalizedName(item.location)) || "";
    const participantChanged = changed(item.participantIds, participantIds);
    const locationChanged = Boolean(locationId && locationId !== item.locationId);
    if (!participantChanged && !locationChanged) return item;
    if (locationChanged) migratedReferenceCount += 1;
    changedTimelineIds.push(item.id);
    return { ...item, participantIds, locationId };
  });

  const clues = data.clues.map((item) => {
    const relatedCharacterIds = mergeIds(
      item.relatedCharacterIds,
      item.relatedCharacters.map((name) => characterNames.get(normalizedName(name)))
    );
    if (!changed(item.relatedCharacterIds, relatedCharacterIds)) return item;
    changedClueIds.push(item.id);
    return { ...item, relatedCharacterIds };
  });

  const conflicts = data.conflicts.map((item) => {
    const partyEntityIds = mergeIds(
      item.partyEntityIds,
      item.parties.map((name) => entityNames.get(normalizedName(name)))
    );
    const relatedCharacterIds = mergeIds(
      item.relatedCharacterIds,
      item.relatedCharacters.map((name) => characterNames.get(normalizedName(name)))
    );
    const relatedFactionIds = mergeIds(
      item.relatedFactionIds,
      item.relatedFactions.map((name) => factionNames.get(normalizedName(name)))
    );
    const partiesChanged = changed(item.partyEntityIds, partyEntityIds);
    const charactersChanged = changed(item.relatedCharacterIds, relatedCharacterIds);
    const factionsChanged = changed(item.relatedFactionIds, relatedFactionIds);
    if (!partiesChanged && !charactersChanged && !factionsChanged) return item;
    changedConflictIds.push(item.id);
    return { ...item, partyEntityIds, relatedCharacterIds, relatedFactionIds };
  });

  const chapters = data.chapters.map((item) => {
    const characterIds = mergeIds(
      item.characterIds,
      item.characters.map((name) => characterNames.get(normalizedName(name)))
    );
    const worldRefIds = mergeIds(
      item.worldRefIds,
      item.worldRefs.map((name) => worldNames.get(normalizedName(name)))
    );
    const charactersChanged = changed(item.characterIds, characterIds);
    const worldChanged = changed(item.worldRefIds, worldRefIds);
    if (!charactersChanged && !worldChanged) return item;
    chaptersChanged = true;
    return { ...item, characterIds, worldRefIds };
  });

  return {
    ...data,
    characters,
    worldEntries,
    timeline,
    clues,
    conflicts,
    chapters,
    changedCharacterIds,
    changedWorldIds,
    changedTimelineIds,
    changedClueIds,
    changedConflictIds,
    chaptersChanged,
    migratedReferenceCount
  };
};

const hit = (
  sourceKind: StoryReferenceHit["sourceKind"],
  sourceId: string,
  sourceTitle: string,
  field: string,
  matched: string
): StoryReferenceHit => ({ sourceKind, sourceId, sourceTitle, field, matched });

export const collectStoryEntityNames = (data: StoryReferenceData, target: StoryEntityRef): Set<string> => {
  const names = new Set<string>();
  const push = (value: string) => {
    const trimmed = value.trim();
    if (trimmed) {
      names.add(trimmed);
    }
  };
  switch (target.kind) {
    case "character": {
      const character = data.characters.find((item) => item.id === target.id);
      if (character) {
        push(character.name);
        character.aliases.forEach(push);
      }
      break;
    }
    case "world": {
      const entry = data.worldEntries.find((item) => item.id === target.id);
      if (entry) {
        push(entry.title);
      }
      break;
    }
    case "timeline": {
      const event = data.timeline.find((item) => item.id === target.id);
      if (event) {
        push(event.title);
      }
      break;
    }
    case "clue": {
      const clue = data.clues.find((item) => item.id === target.id);
      if (clue) {
        push(clue.title);
      }
      break;
    }
    case "term": {
      const term = data.terms.find((item) => item.id === target.id);
      if (term) {
        push(term.name);
        term.aliases.forEach(push);
      }
      break;
    }
    case "conflict": {
      const conflict = data.conflicts.find((item) => item.id === target.id);
      if (conflict) {
        push(conflict.title);
      }
      break;
    }
  }
  return names;
};

export const findStoryReferences = (data: StoryReferenceData, target: StoryEntityRef): StoryReferenceHit[] => {
  const resolvedData = migrateStoryReferencesToIds(data);
  const names = collectStoryEntityNames(resolvedData, target);
  if (!names.size) {
    return [];
  }
  const hits: StoryReferenceHit[] = [];
  const matchExact = (value: string): string | undefined => (names.has(value.trim()) ? value.trim() : undefined);
  const matchWithin = (value: string): string | undefined =>
    [...names].find((name) => name.length >= 2 && value.includes(name));

  for (const character of resolvedData.characters) {
    if (target.kind === "character" && character.id === target.id) {
      continue;
    }
    let relationshipNameMatched = false;
    for (const relation of character.currentState.relationships) {
      if (matchWithin(relation)) {
        relationshipNameMatched = true;
        hits.push(hit("character", character.id, character.name, "人物关系", relation));
      }
    }
    if (
      target.kind === "character" &&
      character.currentState.relationshipCharacterIds?.includes(target.id) &&
      !relationshipNameMatched
    ) {
      hits.push(hit("character", character.id, character.name, "人物关系", target.id));
    }
    if (
      target.kind === "world" &&
      (character.currentState.locationId === target.id || matchExact(character.currentState.location))
    ) {
      hits.push(
        hit("character", character.id, character.name, "当前位置", character.currentState.location || target.id)
      );
    }
  }

  for (const entry of resolvedData.worldEntries) {
    if (target.kind === "world" && entry.id === target.id) {
      continue;
    }
    const relatedCharacterMatches = entry.relatedCharacters.filter((name) => matchExact(name));
    for (const name of relatedCharacterMatches) {
      hits.push(hit("world", entry.id, entry.title, "关联人物", name));
    }
    if (
      target.kind === "character" &&
      entry.relatedCharacterIds?.includes(target.id) &&
      !relatedCharacterMatches.length
    ) {
      hits.push(hit("world", entry.id, entry.title, "关联人物", target.id));
    }
    const relatedClueMatches = entry.relatedClues.filter((name) => matchExact(name));
    for (const name of relatedClueMatches) {
      hits.push(hit("world", entry.id, entry.title, "关联线索", name));
    }
    if (target.kind === "clue" && entry.relatedClueIds?.includes(target.id) && !relatedClueMatches.length) {
      hits.push(hit("world", entry.id, entry.title, "关联线索", target.id));
    }
  }

  for (const event of resolvedData.timeline) {
    if (target.kind === "timeline" && event.id === target.id) {
      continue;
    }
    const participantMatches = event.participants.filter((name) => matchExact(name));
    for (const name of participantMatches) {
      hits.push(hit("timeline", event.id, event.title, "参与者", name));
    }
    if (target.kind === "character" && event.participantIds?.includes(target.id) && !participantMatches.length) {
      hits.push(hit("timeline", event.id, event.title, "参与者", target.id));
    }
    if (target.kind === "world" && (event.locationId === target.id || matchExact(event.location))) {
      hits.push(hit("timeline", event.id, event.title, "发生地点", event.location || target.id));
    }
  }

  for (const clue of resolvedData.clues) {
    if (target.kind === "clue" && clue.id === target.id) {
      continue;
    }
    const characterMatches = clue.relatedCharacters.filter((name) => matchExact(name));
    for (const name of characterMatches) {
      hits.push(hit("clue", clue.id, clue.title, "涉及人物", name));
    }
    if (target.kind === "character" && clue.relatedCharacterIds?.includes(target.id) && !characterMatches.length) {
      hits.push(hit("clue", clue.id, clue.title, "涉及人物", target.id));
    }
  }

  for (const conflict of resolvedData.conflicts) {
    if (target.kind === "conflict" && conflict.id === target.id) {
      continue;
    }
    for (const [field, values, ids] of [
      ["冲突各方", conflict.parties, conflict.partyEntityIds],
      ["涉及人物", conflict.relatedCharacters, target.kind === "character" ? conflict.relatedCharacterIds : []],
      ["涉及势力", conflict.relatedFactions, target.kind === "world" ? conflict.relatedFactionIds : []]
    ] as const) {
      const matchingNames = values.filter((name) => matchExact(name));
      for (const name of matchingNames) {
        hits.push(hit("conflict", conflict.id, conflict.title, field, name));
      }
      if (ids?.includes(target.id) && !matchingNames.length) {
        hits.push(hit("conflict", conflict.id, conflict.title, field, target.id));
      }
    }
  }

  for (const chapter of resolvedData.chapters) {
    const characterMatches = chapter.characters.filter((name) => matchExact(name));
    for (const name of characterMatches) {
      hits.push(hit("chapter", chapter.id, chapter.title, "章节出场人物", name));
    }
    if (target.kind === "character" && chapter.characterIds?.includes(target.id) && !characterMatches.length) {
      hits.push(hit("chapter", chapter.id, chapter.title, "章节出场人物", target.id));
    }
    const worldMatches = chapter.worldRefs.filter((name) => matchExact(name));
    for (const name of worldMatches) {
      hits.push(hit("chapter", chapter.id, chapter.title, "章节世界观引用", name));
    }
    if (target.kind === "world" && chapter.worldRefIds?.includes(target.id) && !worldMatches.length) {
      hits.push(hit("chapter", chapter.id, chapter.title, "章节世界观引用", target.id));
    }
  }

  return hits;
};

export const detachStoryReferences = (
  data: StoryReferenceData,
  target: StoryEntityRef,
  mode: StoryDetachMode,
  replacement = "",
  namesOverride?: Set<string>
): StoryDetachResult => {
  const resolvedData = migrateStoryReferencesToIds(data);
  const names = namesOverride ?? collectStoryEntityNames(resolvedData, target);
  const changedCharacterIds: string[] = [];
  const changedWorldIds: string[] = [];
  const changedTimelineIds: string[] = [];
  const changedClueIds: string[] = [];
  const changedConflictIds: string[] = [];
  let chaptersChanged = false;

  const replaceList = (values: string[]): string[] => {
    const next: string[] = [];
    for (const value of values) {
      if (!names.has(value.trim())) {
        next.push(value);
      } else if (mode === "replace" && replacement && !next.includes(replacement)) {
        next.push(replacement);
      }
    }
    return next;
  };
  const replaceWithin = (value: string): string | undefined => {
    const matched = [...names].find((name) => name.length >= 2 && value.includes(name));
    if (!matched) {
      return value;
    }
    return mode === "replace" && replacement ? value.replaceAll(matched, replacement) : undefined;
  };
  // Location-style scalar fields only reference world entries by title.
  const replaceScalar = (value: string): string =>
    target.kind === "world" && names.has(value.trim()) ? (mode === "replace" ? replacement : "") : value;
  const listChanged = (before: string[], after: string[]): boolean =>
    before.length !== after.length || before.some((value, index) => value !== after[index]);
  const replacementId = (() => {
    const normalized = normalizedName(replacement);
    if (!normalized || mode !== "replace") return undefined;
    if (target.kind === "character") {
      return resolvedData.characters.find((item) =>
        [item.name, ...item.aliases].some((name) => normalizedName(name) === normalized)
      )?.id;
    }
    if (target.kind === "world") {
      return resolvedData.worldEntries.find((item) => normalizedName(item.title) === normalized)?.id;
    }
    return undefined;
  })();
  const replaceIdList = (values: string[] | undefined): string[] => {
    const next = (values ?? []).filter((id) => id !== target.id);
    if (replacementId && !next.includes(replacementId)) next.push(replacementId);
    return next;
  };

  const characters = resolvedData.characters.map((character) => {
    if (target.kind === "character" && character.id === target.id) {
      return character;
    }
    const relationships = character.currentState.relationships
      .map(replaceWithin)
      .filter((relation): relation is string => relation !== undefined);
    const location = replaceScalar(character.currentState.location);
    const relationshipCharacterIds =
      target.kind === "character"
        ? replaceIdList(character.currentState.relationshipCharacterIds)
        : (character.currentState.relationshipCharacterIds ?? []);
    const locationId =
      target.kind === "world" && character.currentState.locationId === target.id
        ? (replacementId ?? "")
        : (character.currentState.locationId ?? "");
    if (
      listChanged(character.currentState.relationships, relationships) ||
      location !== character.currentState.location ||
      listChanged(character.currentState.relationshipCharacterIds ?? [], relationshipCharacterIds) ||
      locationId !== (character.currentState.locationId ?? "")
    ) {
      changedCharacterIds.push(character.id);
      return {
        ...character,
        currentState: { ...character.currentState, relationships, location, relationshipCharacterIds, locationId }
      };
    }
    return character;
  });

  const worldEntries = resolvedData.worldEntries.map((entry) => {
    if (target.kind === "world" && entry.id === target.id) {
      return entry;
    }
    const relatedCharacters = replaceList(entry.relatedCharacters);
    const relatedClues = replaceList(entry.relatedClues);
    const relatedCharacterIds =
      target.kind === "character" ? replaceIdList(entry.relatedCharacterIds) : (entry.relatedCharacterIds ?? []);
    const relatedClueIds = target.kind === "clue" ? replaceIdList(entry.relatedClueIds) : (entry.relatedClueIds ?? []);
    if (
      listChanged(entry.relatedCharacters, relatedCharacters) ||
      listChanged(entry.relatedClues, relatedClues) ||
      listChanged(entry.relatedCharacterIds ?? [], relatedCharacterIds) ||
      listChanged(entry.relatedClueIds ?? [], relatedClueIds)
    ) {
      changedWorldIds.push(entry.id);
      return { ...entry, relatedCharacters, relatedClues, relatedCharacterIds, relatedClueIds };
    }
    return entry;
  });

  const timeline = resolvedData.timeline.map((event) => {
    if (target.kind === "timeline" && event.id === target.id) {
      return event;
    }
    const participants = replaceList(event.participants);
    const location = replaceScalar(event.location);
    const participantIds =
      target.kind === "character" ? replaceIdList(event.participantIds) : (event.participantIds ?? []);
    const locationId =
      target.kind === "world" && event.locationId === target.id ? (replacementId ?? "") : (event.locationId ?? "");
    if (
      listChanged(event.participants, participants) ||
      location !== event.location ||
      listChanged(event.participantIds ?? [], participantIds) ||
      locationId !== (event.locationId ?? "")
    ) {
      changedTimelineIds.push(event.id);
      return { ...event, participants, location, participantIds, locationId };
    }
    return event;
  });

  const clues = resolvedData.clues.map((clue) => {
    if (target.kind === "clue" && clue.id === target.id) {
      return clue;
    }
    const relatedCharacters = replaceList(clue.relatedCharacters);
    const relatedCharacterIds =
      target.kind === "character" ? replaceIdList(clue.relatedCharacterIds) : (clue.relatedCharacterIds ?? []);
    if (
      listChanged(clue.relatedCharacters, relatedCharacters) ||
      listChanged(clue.relatedCharacterIds ?? [], relatedCharacterIds)
    ) {
      changedClueIds.push(clue.id);
      return { ...clue, relatedCharacters, relatedCharacterIds };
    }
    return clue;
  });

  const conflicts = resolvedData.conflicts.map((conflict) => {
    if (target.kind === "conflict" && conflict.id === target.id) {
      return conflict;
    }
    const parties = replaceList(conflict.parties);
    const relatedCharacters = replaceList(conflict.relatedCharacters);
    const relatedFactions = replaceList(conflict.relatedFactions);
    const partyEntityIds = replaceIdList(conflict.partyEntityIds);
    const relatedCharacterIds =
      target.kind === "character" ? replaceIdList(conflict.relatedCharacterIds) : (conflict.relatedCharacterIds ?? []);
    const relatedFactionIds =
      target.kind === "world" ? replaceIdList(conflict.relatedFactionIds) : (conflict.relatedFactionIds ?? []);
    if (
      listChanged(conflict.parties, parties) ||
      listChanged(conflict.relatedCharacters, relatedCharacters) ||
      listChanged(conflict.relatedFactions, relatedFactions) ||
      listChanged(conflict.partyEntityIds ?? [], partyEntityIds) ||
      listChanged(conflict.relatedCharacterIds ?? [], relatedCharacterIds) ||
      listChanged(conflict.relatedFactionIds ?? [], relatedFactionIds)
    ) {
      changedConflictIds.push(conflict.id);
      return {
        ...conflict,
        parties,
        relatedCharacters,
        relatedFactions,
        partyEntityIds,
        relatedCharacterIds,
        relatedFactionIds
      };
    }
    return conflict;
  });

  const chapters = resolvedData.chapters.map((chapter) => {
    const characterRefs = replaceList(chapter.characters);
    const worldRefs = replaceList(chapter.worldRefs);
    const characterIds =
      target.kind === "character" ? replaceIdList(chapter.characterIds) : (chapter.characterIds ?? []);
    const worldRefIds = target.kind === "world" ? replaceIdList(chapter.worldRefIds) : (chapter.worldRefIds ?? []);
    if (
      listChanged(chapter.characters, characterRefs) ||
      listChanged(chapter.worldRefs, worldRefs) ||
      listChanged(chapter.characterIds ?? [], characterIds) ||
      listChanged(chapter.worldRefIds ?? [], worldRefIds)
    ) {
      chaptersChanged = true;
      return { ...chapter, characters: characterRefs, worldRefs, characterIds, worldRefIds };
    }
    return chapter;
  });

  return {
    characters,
    worldEntries,
    timeline,
    clues,
    conflicts,
    chapters,
    changedCharacterIds,
    changedWorldIds,
    changedTimelineIds,
    changedClueIds,
    changedConflictIds,
    chaptersChanged
  };
};

/**
 * Rename propagation: rewrites every reference to `oldName` across the
 * project so renaming a character or world entry keeps relations, event
 * participants, conflict parties and chapter refs in sync. The renamed
 * entity's own record is left untouched (the caller saves it separately).
 */
export const renameStoryReferences = (
  data: StoryReferenceData,
  target: StoryEntityRef,
  oldName: string,
  newName: string
): StoryDetachResult => detachStoryReferences(data, target, "replace", newName, new Set([oldName.trim()]));
