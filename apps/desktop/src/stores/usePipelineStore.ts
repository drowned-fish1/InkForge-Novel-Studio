import { create } from "zustand";
import { bridge } from "@/lib/browserBridge";
import { useProjectStore } from "@/stores/useProjectStore";
import type { PipelinePresetSummary, PipelineRunView } from "@/types/app";

interface PipelineState {
  presets: PipelinePresetSummary[];
  selectedPresetId: string;
  run?: PipelineRunView;
  running: boolean;
  error?: string;
  loadPresets: () => Promise<void>;
  selectPreset: (presetId: string) => void;
  startPipeline: () => Promise<void>;
  confirmPipelineStep: () => Promise<void>;
  pausePipeline: () => Promise<void>;
  cancelPipeline: () => Promise<void>;
  resetPipeline: () => void;
}

export const usePipelineStore = create<PipelineState>((set, get) => ({
  presets: [],
  selectedPresetId: "full-chapter",
  running: false,
  loadPresets: async () => {
    const presets = await bridge.listPipelinePresets();
    set((state) => ({
      presets,
      selectedPresetId: presets.some((item) => item.id === state.selectedPresetId)
        ? state.selectedPresetId
        : (presets[0]?.id ?? state.selectedPresetId)
    }));
  },
  selectPreset: (presetId) => set({ selectedPresetId: presetId }),
  startPipeline: async () => {
    const { selectedPresetId } = get();
    const { project, current, saveCurrentChapter } = useProjectStore.getState();
    set({ running: true, error: undefined });
    try {
      if (project && current) {
        await saveCurrentChapter();
        if (useProjectStore.getState().saveState === "error") {
          throw new Error(
            useProjectStore.getState().error ?? "Current chapter could not be saved before pipeline start."
          );
        }
      }
      const run = await bridge.startPipeline({
        presetId: selectedPresetId,
        projectPath: project?.projectPath,
        chapterId: current?.plan.id,
        autoCommit: false
      });
      set({ run, running: run.status === "running", error: undefined });
    } catch (error) {
      set({ running: false, error: error instanceof Error ? error.message : "Pipeline failed to start." });
    }
  },
  confirmPipelineStep: async () => {
    set({ running: true, error: undefined });
    try {
      const run = await bridge.confirmPipelineStep();
      const { current, selectChapter } = useProjectStore.getState();
      if (run.status === "completed" && current) {
        await selectChapter(current.plan);
      }
      set({ run, running: run.status === "running", error: undefined });
    } catch (error) {
      set({ running: false, error: error instanceof Error ? error.message : "Pipeline confirmation failed." });
    }
  },
  pausePipeline: async () => {
    try {
      const run = await bridge.pausePipeline();
      set({ run, running: false, error: undefined });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Pipeline pause failed." });
    }
  },
  cancelPipeline: async () => {
    try {
      const run = await bridge.cancelPipeline();
      set({ run, running: false, error: undefined });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Pipeline cancel failed." });
    }
  },
  resetPipeline: () => set({ run: undefined, running: false, error: undefined })
}));
