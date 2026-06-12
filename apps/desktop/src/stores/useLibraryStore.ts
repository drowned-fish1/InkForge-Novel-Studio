import { create } from "zustand";
import type { Character, Clue, Term, TimelineEvent, WorldEntry } from "@inkforge/schemas";
import { bridge } from "@/lib/browserBridge";
import { usePlanningStore } from "@/stores/usePlanningStore";
import { useProjectStore } from "@/stores/useProjectStore";
import type { ConsistencyIssue } from "@/types/app";

interface LibraryState {
  characters: Character[];
  worldEntries: WorldEntry[];
  timeline: TimelineEvent[];
  clues: Clue[];
  terms: Term[];
  consistencyIssues: ConsistencyIssue[];
  resetLibraries: () => void;
  loadLibraries: () => Promise<void>;
  saveCharacter: (character: Character) => Promise<void>;
  saveWorldEntry: (entry: WorldEntry) => Promise<void>;
  saveTimelineEvent: (event: TimelineEvent) => Promise<void>;
  saveClue: (clue: Clue) => Promise<void>;
  saveTerm: (term: Term) => Promise<void>;
  inspectStory: () => Promise<void>;
}

export const useLibraryStore = create<LibraryState>((set) => ({
  characters: [],
  worldEntries: [],
  timeline: [],
  clues: [],
  terms: [],
  consistencyIssues: [],
  resetLibraries: () =>
    set({
      characters: [],
      worldEntries: [],
      timeline: [],
      clues: [],
      terms: [],
      consistencyIssues: []
    }),
  loadLibraries: async () => {
    const project = useProjectStore.getState().project;
    if (!project) {
      return;
    }
    const [characters, worldEntries, timeline, clues, terms, consistencyIssues] = await Promise.all([
      bridge.listCharacters(project.projectPath),
      bridge.listWorldEntries(project.projectPath),
      bridge.listTimeline(project.projectPath),
      bridge.listClues(project.projectPath),
      bridge.listTerms(project.projectPath),
      bridge.inspectStory(project.projectPath)
    ]);
    set({ characters, worldEntries, timeline, clues, terms, consistencyIssues });
    await usePlanningStore.getState().loadPlanningSessions();
  },
  saveCharacter: async (character) => {
    const project = useProjectStore.getState().project;
    if (!project) {
      return;
    }
    set({ characters: await bridge.saveCharacter({ projectPath: project.projectPath, character }) });
  },
  saveWorldEntry: async (entry) => {
    const project = useProjectStore.getState().project;
    if (!project) {
      return;
    }
    set({ worldEntries: await bridge.saveWorldEntry({ projectPath: project.projectPath, entry }) });
  },
  saveTimelineEvent: async (event) => {
    const project = useProjectStore.getState().project;
    if (!project) {
      return;
    }
    set({ timeline: await bridge.saveTimelineEvent({ projectPath: project.projectPath, event }) });
    await useLibraryStore.getState().inspectStory();
  },
  saveClue: async (clue) => {
    const project = useProjectStore.getState().project;
    if (!project) {
      return;
    }
    set({ clues: await bridge.saveClue({ projectPath: project.projectPath, clue }) });
    await useLibraryStore.getState().inspectStory();
  },
  saveTerm: async (term) => {
    const project = useProjectStore.getState().project;
    if (!project) {
      return;
    }
    set({ terms: await bridge.saveTerm({ projectPath: project.projectPath, term }) });
    await useLibraryStore.getState().inspectStory();
  },
  inspectStory: async () => {
    const project = useProjectStore.getState().project;
    if (!project) {
      return;
    }
    set({ consistencyIssues: await bridge.inspectStory(project.projectPath) });
  }
}));
