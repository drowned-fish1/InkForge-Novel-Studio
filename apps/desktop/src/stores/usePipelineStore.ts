import { create } from "zustand";
import type { Pipeline } from "@inkforge/schemas";
import { bridge } from "@/lib/browserBridge";
import { useProjectStore } from "@/stores/useProjectStore";
import type { PipelinePresetSummary, PipelineRunView } from "@/types/app";

interface PipelineState {
  presets: PipelinePresetSummary[];
  customWorkflows: Pipeline[];
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
  skipPipelineStep: () => Promise<void>;
  retryPipelineStep: () => Promise<void>;
  resetPipeline: () => void;
}

export const usePipelineStore = create<PipelineState>((set, get) => ({
  presets: [],
  customWorkflows: [],
  selectedPresetId: "full-chapter",
  running: false,
  loadPresets: async () => {
    const presets = await bridge.listPipelinePresets();
    const projectPath = useProjectStore.getState().project?.projectPath;
    const customWorkflows = projectPath
      ? await bridge
          .loadAgentExtensions(projectPath)
          .then((extensions) => extensions.workflowTemplates.filter((item) => item.enabled))
          .catch(() => [] as Pipeline[])
      : [];
    set((state) => ({
      presets,
      customWorkflows,
      selectedPresetId:
        presets.some((item) => item.id === state.selectedPresetId) ||
        customWorkflows.some((item) => item.id === state.selectedPresetId)
          ? state.selectedPresetId
          : (presets[0]?.id ?? state.selectedPresetId)
    }));
  },
  selectPreset: (presetId) => set({ selectedPresetId: presetId }),
  startPipeline: async () => {
    const { selectedPresetId, customWorkflows } = get();
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
      const customPipeline = customWorkflows.find((item) => item.id === selectedPresetId);
      const run = await bridge.startPipeline({
        presetId: selectedPresetId,
        projectPath: project?.projectPath,
        chapterId: current?.plan.id,
        autoCommit: false,
        customPipeline
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
  skipPipelineStep: async () => {
    try {
      const run = await bridge.skipPipelineStep();
      set({ run, running: false, error: undefined });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Pipeline step could not be skipped." });
    }
  },
  retryPipelineStep: async () => {
    set({ running: true, error: undefined });
    try {
      const run = await bridge.retryPipelineStep();
      set({ run, running: run.status === "running", error: undefined });
    } catch (error) {
      set({ running: false, error: error instanceof Error ? error.message : "Pipeline retry failed." });
    }
  },
  resetPipeline: () => set({ run: undefined, running: false, error: undefined })
}));
