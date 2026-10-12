import { create } from "zustand";
import {
  emptyReferencePreferences,
  maxPinnedReferences,
  parseReferencePreferences,
  referenceKey,
  type PinnedReferencePreferences,
  type WritingReferenceTarget
} from "../lib/writingReferences";

const storageKey = (path: string) => `inkforge:pinned-writing-references:v1:${encodeURIComponent(path)}`;
interface ReferenceState {
  projects: Record<string, PinnedReferencePreferences>;
  hydrate: (path: string) => void;
  pin: (path: string, target: WritingReferenceTarget) => void;
  remove: (path: string, target: WritingReferenceTarget) => void;
  activate: (path: string, target: WritingReferenceTarget) => void;
  collapse: (path: string, collapsed: boolean) => void;
  clear: (path: string) => void;
}
export const useWritingReferenceStore = create<ReferenceState>((set, get) => {
  const read = (path: string) => {
    if (get().projects[path]) return get().projects[path];
    try {
      return parseReferencePreferences(JSON.parse(localStorage.getItem(storageKey(path)) ?? "null"));
    } catch {
      return emptyReferencePreferences();
    }
  };
  const save = (path: string, preferences: PinnedReferencePreferences) => {
    const parsed = parseReferencePreferences(preferences);
    try {
      localStorage.setItem(storageKey(path), JSON.stringify(parsed));
    } catch {
      throw new Error("无法保存固定资料偏好，请检查本地存储空间后重试。");
    }
    set((state) => ({ projects: { ...state.projects, [path]: parsed } }));
  };
  return {
    projects: {},
    hydrate: (path) => {
      if (!get().projects[path]) set((state) => ({ projects: { ...state.projects, [path]: read(path) } }));
    },
    pin: (path, target) => {
      if (!path) return;
      const current = read(path);
      const key = referenceKey(target);
      const exists = current.cards.some((card) => referenceKey(card) === key);
      if (!exists && current.cards.length >= maxPinnedReferences)
        throw new Error(`最多固定 ${maxPinnedReferences} 张资料卡，请先移除一张。`);
      save(path, { cards: exists ? current.cards : [...current.cards, target], activeKey: key, collapsed: false });
    },
    remove: (path, target) => {
      const current = read(path);
      const key = referenceKey(target);
      const cards = current.cards.filter((card) => referenceKey(card) !== key);
      save(path, {
        ...current,
        cards,
        activeKey: current.activeKey === key ? (cards[0] ? referenceKey(cards[0]) : "") : current.activeKey
      });
    },
    activate: (path, target) => save(path, { ...read(path), activeKey: referenceKey(target), collapsed: false }),
    collapse: (path, collapsed) => save(path, { ...read(path), collapsed }),
    clear: (path) => save(path, emptyReferencePreferences())
  };
});
