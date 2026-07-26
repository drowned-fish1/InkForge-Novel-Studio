import { create } from "zustand";
import type {
  Character,
  Clue,
  Conflict,
  StoryEntityRef,
  StoryReferenceHit,
  Term,
  TimelineEvent,
  WorldEntry
} from "@inkforge/schemas";
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
  conflicts: Conflict[];
  consistencyIssues: ConsistencyIssue[];
  resetLibraries: () => void;
  loadLibraries: () => Promise<void>;
  saveCharacter: (character: Character) => Promise<void>;
  saveWorldEntry: (entry: WorldEntry) => Promise<void>;
  saveTimelineEvent: (event: TimelineEvent) => Promise<void>;
  saveClue: (clue: Clue) => Promise<void>;
  saveTerm: (term: Term) => Promise<void>;
  saveConflict: (conflict: Conflict) => Promise<void>;
  findEntityReferences: (target: StoryEntityRef) => Promise<StoryReferenceHit[]>;
  deleteStoryEntity: (
    target: StoryEntityRef,
    mode: "force" | "unlink" | "replace",
    replacement?: string
  ) => Promise<void>;
  inspectStory: () => Promise<void>;
}

export const useLibraryStore = create<LibraryState>((set) => ({
  characters: [],
  worldEntries: [],
  timeline: [],
  clues: [],
  terms: [],
  conflicts: [],
  consistencyIssues: [],
  resetLibraries: () =>
    set({
      characters: [],
      worldEntries: [],
      timeline: [],
      clues: [],
      terms: [],
      conflicts: [],
      consistencyIssues: []
    }),
  loadLibraries: async () => {
    const project = useProjectStore.getState().project;
    if (!project) {
      return;
    }
    const [characters, worldEntries, timeline, clues, terms, conflicts, consistencyIssues] = await Promise.all([
      bridge.listCharacters(project.projectPath),
      bridge.listWorldEntries(project.projectPath),
      bridge.listTimeline(project.projectPath),
      bridge.listClues(project.projectPath),
      bridge.listTerms(project.projectPath),
      bridge.listConflicts(project.projectPath),
      bridge.inspectStory(project.projectPath)
    ]);
    set({ characters, worldEntries, timeline, clues, terms, conflicts, consistencyIssues });
    await usePlanningStore.getState().loadPlanningSessions();
  },
  saveCharacter: async (character) => {
    const project = useProjectStore.getState().project;
    if (!project) {
      return;
    }
    const previous = useLibraryStore.getState().characters.find((item) => item.id === character.id);
    const renamed = Boolean(previous && previous.name.trim() !== character.name.trim());
    set({ characters: await bridge.saveCharacter({ projectPath: project.projectPath, character }) });
    if (renamed) {
      // The main process rewrote references across every store; reload them.
      await useLibraryStore.getState().loadLibraries();
      await useProjectStore.getState().refreshProject();
    }
  },
  saveWorldEntry: async (entry) => {
    const project = useProjectStore.getState().project;
    if (!project) {
      return;
    }
    const previous = useLibraryStore.getState().worldEntries.find((item) => item.id === entry.id);
    const renamed = Boolean(previous && previous.title.trim() !== entry.title.trim());
    set({ worldEntries: await bridge.saveWorldEntry({ projectPath: project.projectPath, entry }) });
    if (renamed) {
      await useLibraryStore.getState().loadLibraries();
      await useProjectStore.getState().refreshProject();
    }
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
  saveConflict: async (conflict) => {
    const project = useProjectStore.getState().project;
    if (!project) {
      return;
    }
    set({ conflicts: await bridge.saveConflict({ projectPath: project.projectPath, conflict }) });
  },
  findEntityReferences: async (target) => {
    const project = useProjectStore.getState().project;
    if (!project) {
      return [];
    }
    return bridge.findEntityReferences(project.projectPath, target);
  },
  deleteStoryEntity: async (target, mode, replacement) => {
    const project = useProjectStore.getState().project;
    if (!project) {
      return;
    }
    await bridge.deleteStoryEntity(project.projectPath, target, mode, replacement);
    await useLibraryStore.getState().loadLibraries();
    if (target.kind === "world" || target.kind === "character") {
      await useProjectStore.getState().refreshProject();
    }
  },
  inspectStory: async () => {
    const project = useProjectStore.getState().project;
    if (!project) {
      return;
    }
    set({ consistencyIssues: await bridge.inspectStory(project.projectPath) });
  }
}));
