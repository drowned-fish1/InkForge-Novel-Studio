import { create } from "zustand";
import { boardFromOutline, createThreeActBoard, type BeatBoard } from "@inkforge/schemas";
import { bridge } from "@/lib/browserBridge";
import { useProjectStore } from "@/stores/useProjectStore";
import type { PlayableExportInput } from "@/types/app";

const PERSIST_DELAY_MS = 600;
let persistTimer: number | undefined;
let boardRevision = 0;
let persistQueue: Promise<void> = Promise.resolve();

interface NarrativeState {
  board: BeatBoard | null;
  loadedFor: string | null;
  exporting: boolean;
  lastExportPath: string | null;
  loadBoard: () => Promise<void>;
  updateBoard: (board: BeatBoard, options?: { flush?: boolean }) => void;
  flushBoard: () => Promise<void>;
  reloadBoard: () => Promise<void>;
  initThreeActs: () => void;
  importFromOutline: () => void;
  exportPlayable: (format: PlayableExportInput["format"]) => Promise<void>;
  resetBoard: () => void;
}

const projectPathOrNull = (): string | null => useProjectStore.getState().project?.projectPath ?? null;

const clearPersistTimer = (): void => {
  window.clearTimeout(persistTimer);
  persistTimer = undefined;
};

const persistNow = (projectPath: string, board: BeatBoard, revision: number): Promise<void> => {
  const operation = persistQueue.then(async () => {
    const saved = await bridge.saveBeatBoard(projectPath, board);
    const state = useNarrativeStore.getState();
    if (state.loadedFor === projectPath && boardRevision === revision && state.board === board) {
      useNarrativeStore.setState({ board: saved });
    }
  });
  persistQueue = operation.catch(() => undefined);
  return operation;
};

export const useNarrativeStore = create<NarrativeState>((set, get) => ({
  board: null,
  loadedFor: null,
  exporting: false,
  lastExportPath: null,
  loadBoard: async () => {
    const projectPath = projectPathOrNull();
    const current = get();
    if (!projectPath || current.loadedFor === projectPath) {
      return;
    }
    clearPersistTimer();
    if (current.loadedFor && current.board) {
      await persistNow(current.loadedFor, current.board, boardRevision);
    }
    const revision = ++boardRevision;
    const board = await bridge.loadBeatBoard(projectPath);
    if (projectPathOrNull() === projectPath && boardRevision === revision) {
      set({ board, loadedFor: projectPath, lastExportPath: null });
    }
  },
  updateBoard: (board, options) => {
    const projectPath = projectPathOrNull();
    if (!projectPath) {
      return;
    }
    const revision = ++boardRevision;
    set({ board });
    clearPersistTimer();
    if (options?.flush) {
      void persistNow(projectPath, board, revision);
      return;
    }
    persistTimer = window.setTimeout(() => {
      const latest = get().board;
      if (latest && get().loadedFor === projectPath) {
        void persistNow(projectPath, latest, boardRevision);
      }
    }, PERSIST_DELAY_MS);
  },
  flushBoard: async () => {
    const projectPath = projectPathOrNull();
    const state = get();
    clearPersistTimer();
    if (projectPath && state.loadedFor === projectPath && state.board) {
      await persistNow(projectPath, state.board, boardRevision);
    } else {
      await persistQueue;
    }
  },
  reloadBoard: async () => {
    const projectPath = projectPathOrNull();
    if (!projectPath) {
      return;
    }
    clearPersistTimer();
    await persistQueue;
    const revision = ++boardRevision;
    const board = await bridge.loadBeatBoard(projectPath);
    if (projectPathOrNull() === projectPath && boardRevision === revision) {
      set({ board, loadedFor: projectPath, lastExportPath: null });
    }
  },
  initThreeActs: () => {
    get().updateBoard(createThreeActBoard(), { flush: true });
  },
  importFromOutline: () => {
    const outline = useProjectStore.getState().project?.outline;
    if (outline) {
      get().updateBoard(boardFromOutline(outline), { flush: true });
    }
  },
  exportPlayable: async (format) => {
    const projectPath = projectPathOrNull();
    const board = get().board;
    if (!projectPath || !board) {
      return;
    }
    set({ exporting: true });
    try {
      clearPersistTimer();
      await persistNow(projectPath, board, boardRevision);
      const exportPath = await bridge.exportPlayable({ projectPath, format });
      set({ lastExportPath: exportPath ?? null });
    } finally {
      set({ exporting: false });
    }
  },
  resetBoard: () => {
    clearPersistTimer();
    boardRevision += 1;
    set({ board: null, loadedFor: null, lastExportPath: null });
  }
}));
