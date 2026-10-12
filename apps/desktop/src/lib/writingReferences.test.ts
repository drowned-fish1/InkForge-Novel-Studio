import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { CharacterSchema, TermSchema, WorldEntrySchema } from "@inkforge/schemas";
import {
  parseReferencePreferences,
  previewReferenceEntries,
  referenceKey,
  writingReferenceEntries,
  findWritingReferences
} from "./writingReferences";
import { useWritingReferenceStore } from "../stores/useWritingReferenceStore";

describe("writing reference identity and cards", () => {
  it("prioritizes exact names over mentions in fields and requires a choice for shared aliases", () => {
    const entries = writingReferenceEntries(
      [
        CharacterSchema.parse({ id: "a", name: "林舟", aliases: ["小林"], currentState: { location: "港口" } }),
        CharacterSchema.parse({ id: "b", name: "秦月", aliases: ["小林"] })
      ],
      [],
      [WorldEntrySchema.parse({ id: "w", title: "港口", type: "location" })]
    );
    expect(findWritingReferences(entries, "港口").matches[0].kind).toBe("location");
    expect(findWritingReferences(entries, "小林").ambiguous).toBe(true);
    expect(findWritingReferences(entries, "林舟").ambiguous).toBe(false);
  });
  it("does not choose a person arbitrarily for shared names, aliases or term names", () => {
    const characters = [
      CharacterSchema.parse({ id: "a", name: "林舟", aliases: ["小林", "林舟"] }),
      CharacterSchema.parse({ id: "b", name: "林月", aliases: ["小林"] })
    ];
    const entries = previewReferenceEntries(characters, [
      TermSchema.parse({ id: "t", name: "林舟", definition: "同名术语" })
    ]);
    expect(entries.find((entry) => entry.name === "林舟")?.id).toBe(`lookup-${encodeURIComponent("林舟")}`);
    expect(entries.find((entry) => entry.name === "小林")?.id).toBe(`lookup-${encodeURIComponent("小林")}`);
    expect(entries.find((entry) => entry.name === "林月")?.id).toBe("character-b");
    expect(entries.filter((entry) => entry.name === "林舟")).toHaveLength(1);
  });
  it("keeps single-character common words out and matches longer names first", () => {
    const entries = previewReferenceEntries(
      [CharacterSchema.parse({ id: "a", name: "林舟", aliases: ["林", "林舟先生"] })],
      []
    );
    expect(entries.map((entry) => entry.name)).toEqual(["林舟先生", "林舟"]);
  });
  it("reads updated fields without copying stale novel data into pin preferences", () => {
    const entry = writingReferenceEntries(
      [CharacterSchema.parse({ id: "a", name: "新名字", currentState: { secrets: ["旧信"] } })],
      [],
      [WorldEntrySchema.parse({ id: "w", title: "山门", type: "location" })]
    );
    expect(entry[0].fields).toContainEqual(["秘密", "旧信"]);
    expect(referenceKey(entry[1])).toBe(referenceKey({ kind: "world", id: "w" }));
    expect(
      parseReferencePreferences({ cards: [{ kind: "character", id: "a", title: "旧名字" }], activeKey: "character:a" })
        .cards
    ).toEqual([{ kind: "character", id: "a" }]);
  });
  it("rejects malformed settings, deduplicates world kinds and bounds card count", () => {
    expect(parseReferencePreferences(null).cards).toEqual([]);
    const preferences = parseReferencePreferences({
      cards: [
        { kind: "chapter", id: "c" },
        null,
        { kind: "character", id: "" },
        { kind: "world", id: "w" },
        { kind: "location", id: "w" },
        ...Array.from({ length: 20 }, (_, index) => ({ kind: "character", id: `${index}` }))
      ],
      activeKey: "missing",
      collapsed: "true"
    });
    expect(preferences.cards).toHaveLength(6);
    expect(preferences.activeKey).toBe("world:w");
    expect(preferences.collapsed).toBe(false);
  });
});

describe("project-scoped pinned references", () => {
  let memory: Map<string, string>;
  beforeEach(() => {
    memory = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, value)
    });
    useWritingReferenceStore.setState({ projects: {} });
  });
  afterEach(() => vi.unstubAllGlobals());
  it("persists pins and active/collapsed state across a store reset, isolated by project", () => {
    const store = useWritingReferenceStore.getState();
    store.pin("book-a", { kind: "character", id: "same-id" });
    store.pin("book-a", { kind: "term", id: "term" });
    store.collapse("book-a", true);
    store.pin("book-b", { kind: "world", id: "same-id" });
    useWritingReferenceStore.setState({ projects: {} });
    store.hydrate("book-a");
    store.hydrate("book-b");
    const projects = useWritingReferenceStore.getState().projects;
    expect(projects["book-a"].cards).toHaveLength(2);
    expect(projects["book-a"].activeKey).toBe("term:term");
    expect(projects["book-a"].collapsed).toBe(true);
    expect(projects["book-b"].cards).toEqual([{ kind: "world", id: "same-id" }]);
  });
  it("activates existing pins at the limit and preserves other pins when removing an active card", () => {
    const store = useWritingReferenceStore.getState();
    for (let index = 0; index < 6; index++) store.pin("book", { kind: "character", id: `${index}` });
    expect(() => store.pin("book", { kind: "term", id: "extra" })).toThrow("最多固定");
    store.pin("book", { kind: "character", id: "0" });
    expect(useWritingReferenceStore.getState().projects.book.cards).toHaveLength(6);
    store.remove("book", { kind: "character", id: "0" });
    expect(useWritingReferenceStore.getState().projects.book.activeKey).toBe("character:1");
  });
  it("does not claim a pin was persisted when storage fails", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      }
    });
    expect(() => useWritingReferenceStore.getState().pin("book", { kind: "character", id: "a" })).toThrow("无法保存");
    expect(useWritingReferenceStore.getState().projects.book).toBeUndefined();
  });
});
