import { create } from "zustand";
import type { SimulationDocument, SimulationScenario } from "@inkforge/schemas";
import { bridge } from "@/lib/browserBridge";
import { useProjectStore } from "@/stores/useProjectStore";
import type { SimulationRunEvent } from "@/types/app";

let runAbort: AbortController | null = null;

interface SimulationState {
  documents: SimulationDocument[];
  loadedFor: string | null;
  activeScenarioId: string | null;
  running: boolean;
  runEvents: SimulationRunEvent[];
  error: string | null;
  loadSimulations: () => Promise<void>;
  setActiveScenario: (scenarioId: string | null) => void;
  saveScenario: (scenario: SimulationScenario) => Promise<void>;
  runScenario: (scenarioId: string) => Promise<void>;
  cancelRun: () => void;
  reset: () => void;
}

const projectPathOrNull = (): string | null => useProjectStore.getState().project?.projectPath ?? null;

const upsertDocument = (documents: SimulationDocument[], document: SimulationDocument): SimulationDocument[] => [
  document,
  ...documents.filter((item) => item.scenario.id !== document.scenario.id)
];

export const useSimulationStore = create<SimulationState>((set, get) => ({
  documents: [],
  loadedFor: null,
  activeScenarioId: null,
  running: false,
  runEvents: [],
  error: null,
  loadSimulations: async () => {
    const projectPath = projectPathOrNull();
    if (!projectPath || get().loadedFor === projectPath) {
      return;
    }
    const documents = await bridge.listSimulations(projectPath);
    set({
      documents,
      loadedFor: projectPath,
      activeScenarioId: documents[0]?.scenario.id ?? null,
      runEvents: [],
      error: null
    });
  },
  setActiveScenario: (scenarioId) => set({ activeScenarioId: scenarioId, runEvents: [], error: null }),
  saveScenario: async (scenario) => {
    const projectPath = projectPathOrNull();
    if (!projectPath) {
      return;
    }
    const document = await bridge.saveSimulationScenario(projectPath, scenario);
    set({
      documents: upsertDocument(get().documents, document),
      activeScenarioId: document.scenario.id,
      error: null
    });
  },
  runScenario: async (scenarioId) => {
    const projectPath = projectPathOrNull();
    if (!projectPath || get().running) {
      return;
    }
    runAbort = new AbortController();
    set({ running: true, runEvents: [], error: null });
    try {
      const document = await bridge.runSimulation({ projectPath, scenarioId }, runAbort.signal, (event) =>
        set((state) => ({ runEvents: [...state.runEvents, event] }))
      );
      set({ documents: upsertDocument(get().documents, document) });
      const run = document.runs[0];
      if (run?.status === "failed" && run.error) {
        set({ error: run.error });
      }
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) {
        set({ error: error instanceof Error ? error.message : String(error) });
      }
      const projectStillOpen = projectPathOrNull() === projectPath;
      if (projectStillOpen) {
        const documents = await bridge.listSimulations(projectPath);
        set({ documents });
      }
    } finally {
      runAbort = null;
      set({ running: false });
    }
  },
  cancelRun: () => {
    runAbort?.abort();
  },
  reset: () => {
    runAbort?.abort();
    runAbort = null;
    set({ documents: [], loadedFor: null, activeScenarioId: null, running: false, runEvents: [], error: null });
  }
}));
