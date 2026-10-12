import type { Character, Term, WorldEntry } from "@inkforge/schemas";

export type WritingReferenceKind = "character" | "term" | "world" | "location" | "faction";
export interface WritingReferenceTarget {
  kind: WritingReferenceKind;
  id: string;
}
export interface WritingReferenceEntry extends WritingReferenceTarget {
  title: string;
  type: string;
  aliases: string[];
  fields: Array<[string, string]>;
}
export interface PinnedReferencePreferences {
  cards: WritingReferenceTarget[];
  activeKey: string;
  collapsed: boolean;
}
export const maxPinnedReferences = 6;
export const previewReferenceEntries = (characters: Character[], terms: Term[]) => {
  const names = new Map<string, { id: string; name: string; title: string }>();
  const add = (id: string, name: string, title: string) => {
    const normalized = name.trim();
    if (normalized.length < 2) return;
    const key = normalized.toLocaleLowerCase("zh-CN");
    const previous = names.get(key);
    if (previous && previous.id !== id)
      names.set(key, {
        id: `lookup-${encodeURIComponent(previous.name)}`,
        name: previous.name,
        title: `多个资料使用「${previous.name}」，点击选择`
      });
    else if (!previous) names.set(key, { id, name: normalized, title });
  };
  characters.forEach((character) =>
    [character.name, ...character.aliases].forEach((name) =>
      add(`character-${character.id}`, name, `人物：${character.name}`)
    )
  );
  terms.forEach((term) =>
    [term.name, ...term.aliases].forEach((name) =>
      add(`term-${term.id}`, name, `术语：${term.name}${term.definition ? ` - ${term.definition}` : ""}`)
    )
  );
  return [...names.values()].sort((a, b) => b.name.length - a.name.length);
};
export const referenceKey = (target: WritingReferenceTarget) =>
  `${["world", "location", "faction"].includes(target.kind) ? "world" : target.kind}:${target.id}`;
export const emptyReferencePreferences = (): PinnedReferencePreferences => ({
  cards: [],
  activeKey: "",
  collapsed: false
});
export const findWritingReferences = (entries: WritingReferenceEntry[], query: string) => {
  const keyword = query.trim().toLocaleLowerCase("zh-CN");
  const exact = (entry: WritingReferenceEntry) =>
    Boolean(keyword && [entry.title, ...entry.aliases].some((name) => name.toLocaleLowerCase("zh-CN") === keyword));
  const matches = entries.filter(
    (entry) =>
      !keyword ||
      [entry.title, ...entry.aliases, ...entry.fields.map(([, value]) => value)]
        .join(" ")
        .toLocaleLowerCase("zh-CN")
        .includes(keyword)
  );
  const rank = (entry: WritingReferenceEntry) =>
    keyword && entry.title.toLocaleLowerCase("zh-CN") === keyword ? 2 : exact(entry) ? 1 : 0;
  matches.sort((a, b) => rank(b) - rank(a));
  return { matches, ambiguous: matches.filter(exact).length > 1 };
};

export const parseReferencePreferences = (value: unknown): PinnedReferencePreferences => {
  if (!value || typeof value !== "object") return emptyReferencePreferences();
  const raw = value as Record<string, unknown>;
  const cards: WritingReferenceTarget[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(raw.cards) ? raw.cards : []) {
    if (!item || typeof item !== "object") continue;
    const target = item as WritingReferenceTarget;
    if (
      !["character", "term", "world", "location", "faction"].includes(target.kind) ||
      typeof target.id !== "string" ||
      !target.id.trim() ||
      target.id.length > 500
    )
      continue;
    const key = referenceKey(target);
    if (seen.has(key) || cards.length === maxPinnedReferences) continue;
    seen.add(key);
    cards.push({ kind: target.kind, id: target.id });
  }
  return {
    cards,
    activeKey:
      typeof raw.activeKey === "string" && seen.has(raw.activeKey)
        ? raw.activeKey
        : cards[0]
          ? referenceKey(cards[0])
          : "",
    collapsed: raw.collapsed === true
  };
};

export const writingReferenceEntries = (
  characters: Character[],
  terms: Term[],
  world: WorldEntry[]
): WritingReferenceEntry[] => [
  ...characters.map(
    (item): WritingReferenceEntry => ({
      kind: "character",
      id: item.id,
      title: item.name,
      type: "人物",
      aliases: item.aliases,
      fields: [
        ["身份", item.profile.identity],
        ["年龄", item.profile.age],
        ["动机", item.profile.motivation],
        ["性格", item.profile.personality],
        ["资料库当前位置", item.currentState.location],
        ["境界", item.currentState.powerLevel],
        ["成长线", item.currentState.arc],
        ["关系", item.currentState.relationships.join("；")],
        ["秘密", item.currentState.secrets.join("；")],
        ["语言风格", item.voiceNotes],
        ["标签", item.tags.join("、")]
      ]
    })
  ),
  ...terms.map(
    (item): WritingReferenceEntry => ({
      kind: "term",
      id: item.id,
      title: item.name,
      type: "术语",
      aliases: item.aliases,
      fields: [
        ["类别", item.category],
        ["定义", item.definition],
        ["锁定", item.locked ? "已锁定" : ""]
      ]
    })
  ),
  ...world.map(
    (item): WritingReferenceEntry => ({
      kind:
        item.type === "location" ? "location" : ["faction", "organization"].includes(item.type) ? "faction" : "world",
      id: item.id,
      title: item.title,
      type: item.type === "location" ? "地点" : ["faction", "organization"].includes(item.type) ? "势力" : "世界观",
      aliases: item.tags,
      fields: [
        ["摘要", item.summary],
        ["设定", item.content],
        ["相关人物", item.relatedCharacters.join("、")],
        ["相关伏笔", item.relatedClues.join("、")],
        ["锁定", item.locked ? "已锁定" : ""]
      ]
    })
  )
];
