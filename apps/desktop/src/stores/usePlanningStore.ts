import { create } from "zustand";
import { bridge } from "@/lib/browserBridge";
import { useLibraryStore } from "@/stores/useLibraryStore";
import { useProjectStore } from "@/stores/useProjectStore";
import type { PlanningImportResult, PlanningImportSelection, PlanningPackage, PlanningSession } from "@/types/app";

const isAbortError = (error: unknown): boolean =>
  (error instanceof DOMException && error.name === "AbortError") ||
  (error instanceof Error && error.name === "AbortError");

interface PlanningState {
  planningSessions: PlanningSession[];
  activePlanningSessionId?: string;
  planningRunning: boolean;
  lastPlanningImportResult?: PlanningImportResult;
  lastPlanningRollbackSnapshotId?: string;
  resetPlanning: () => void;
  cancelPlanning: () => void;
  loadPlanningSessions: () => Promise<void>;
  createPlanningSession: (seedPrompt: string) => Promise<void>;
  answerPlanningQuestion: (message: string) => Promise<void>;
  generatePlanningPackage: (sessionId: string) => Promise<void>;
  updatePlanningPackageDraft: (sessionId: string, planningPackage: PlanningPackage) => Promise<void>;
  importPlanningPackage: (sessionId: string, selection: PlanningImportSelection) => Promise<void>;
  rollbackPlanningImport: (snapshotId: string) => Promise<void>;
}

export const usePlanningStore = create<PlanningState>((set, get) => {
  let abortController: AbortController | null = null;

  return {
    planningSessions: [],
    planningRunning: false,
    resetPlanning: () => {
      abortController?.abort();
      abortController = null;
      set({
        planningSessions: [],
        activePlanningSessionId: undefined,
        planningRunning: false,
        lastPlanningImportResult: undefined,
        lastPlanningRollbackSnapshotId: undefined
      });
    },
    cancelPlanning: () => {
      abortController?.abort();
      abortController = null;
      set({ planningRunning: false });
    },
    loadPlanningSessions: async () => {
      const project = useProjectStore.getState().project;
      if (!project) {
        return;
      }
      const planningSessions = await bridge.listPlanningSessions(project.projectPath);
      set((state) => ({
        planningSessions,
        activePlanningSessionId: state.activePlanningSessionId ?? planningSessions[0]?.id
      }));
    },
    createPlanningSession: async (seedPrompt) => {
      const project = useProjectStore.getState().project;
      if (!project) {
        return;
      }
      const now = new Date().toISOString();
      const session: PlanningSession = {
        id: `plan_${Date.now()}`,
        projectId: project.meta.projectId,
        title: seedPrompt.trim().slice(0, 28) || "新规划",
        status: "clarifying",
        messages: seedPrompt.trim()
          ? [{ id: `msg_${Date.now()}_seed`, role: "user", content: seedPrompt.trim(), createdAt: now }]
          : [],
        rawOutput: "",
        createdAt: now,
        updatedAt: now
      };
      abortController?.abort();
      abortController = new AbortController();
      set({ planningRunning: true });
      useProjectStore.setState({ error: undefined });
      try {
        let planningSessions = await bridge.savePlanningSession(project.projectPath, session);
        const active = await bridge.runPlanningAi(
          { projectPath: project.projectPath, sessionId: session.id, mode: "questions" },
          abortController.signal
        );
        if (abortController.signal.aborted) return;
        planningSessions = planningSessions.map((item) => (item.id === active.id ? active : item));
        abortController = null;
        set({ planningSessions, activePlanningSessionId: active.id, planningRunning: false });
      } catch (error) {
        if (isAbortError(error)) {
          abortController = null;
          set({ planningRunning: false });
          return;
        }
        abortController = null;
        set({ planningRunning: false });
        useProjectStore.setState({ error: error instanceof Error ? error.message : "规划会话创建失败" });
      }
    },
    answerPlanningQuestion: async (message) => {
      const project = useProjectStore.getState().project;
      const sessionId = get().activePlanningSessionId;
      if (!project || !sessionId) {
        return;
      }
      abortController?.abort();
      abortController = new AbortController();
      set({ planningRunning: true });
      useProjectStore.setState({ error: undefined });
      try {
        const session = await bridge.runPlanningAi(
          { projectPath: project.projectPath, sessionId, mode: "questions", userMessage: message },
          abortController.signal
        );
        if (abortController.signal.aborted) return;
        abortController = null;
        set((state) => ({
          planningRunning: false,
          planningSessions: state.planningSessions.map((item) => (item.id === session.id ? session : item))
        }));
      } catch (error) {
        if (isAbortError(error)) {
          abortController = null;
          set({ planningRunning: false });
          return;
        }
        abortController = null;
        set({ planningRunning: false });
        useProjectStore.setState({ error: error instanceof Error ? error.message : "规划追问失败" });
      }
    },
    generatePlanningPackage: async (sessionId) => {
      const project = useProjectStore.getState().project;
      if (!project) {
        return;
      }
      abortController?.abort();
      abortController = new AbortController();
      set({ planningRunning: true });
      useProjectStore.setState({ error: undefined });
      try {
        const session = await bridge.runPlanningAi(
          { projectPath: project.projectPath, sessionId, mode: "package" },
          abortController.signal
        );
        if (abortController.signal.aborted) return;
        abortController = null;
        set((state) => ({
          planningRunning: false,
          activePlanningSessionId: session.id,
          planningSessions: state.planningSessions.map((item) => (item.id === session.id ? session : item))
        }));
      } catch (error) {
        if (isAbortError(error)) {
          abortController = null;
          set({ planningRunning: false });
          return;
        }
        abortController = null;
        set({ planningRunning: false });
        useProjectStore.setState({ error: error instanceof Error ? error.message : "规划包生成失败" });
      }
    },
    updatePlanningPackageDraft: async (sessionId, planningPackage) => {
      const project = useProjectStore.getState().project;
      const session = get().planningSessions.find((item) => item.id === sessionId);
      if (!project || !session) {
        return;
      }
      const next = {
        ...session,
        package: planningPackage,
        status: "ready" as const,
        updatedAt: new Date().toISOString()
      };
      set({
        planningSessions: await bridge.savePlanningSession(project.projectPath, next),
        activePlanningSessionId: sessionId
      });
    },
    importPlanningPackage: async (sessionId, selection) => {
      const project = useProjectStore.getState().project;
      if (!project) {
        return;
      }
      set({ planningRunning: true });
      useProjectStore.setState({ error: undefined });
      try {
        const result = await bridge.importPlanningPackage(project.projectPath, sessionId, selection);
        const refreshed = await bridge.openProject(project.projectPath);
        if (refreshed) {
          useProjectStore.setState({ project: refreshed });
        }
        await useLibraryStore.getState().loadLibraries();
        set({ planningRunning: false, lastPlanningImportResult: result, lastPlanningRollbackSnapshotId: undefined });
      } catch (error) {
        set({ planningRunning: false });
        useProjectStore.setState({ error: error instanceof Error ? error.message : "规划导入失败" });
      }
    },
    rollbackPlanningImport: async (snapshotId) => {
      const project = useProjectStore.getState().project;
      if (!project) {
        return;
      }
      set({ planningRunning: true });
      useProjectStore.setState({ error: undefined });
      try {
        await bridge.restorePlanningSnapshot(project.projectPath, snapshotId);
        const refreshed = await bridge.openProject(project.projectPath);
        if (refreshed) {
          useProjectStore.setState({ project: refreshed });
        }
        await useLibraryStore.getState().loadLibraries();
        set({
          planningRunning: false,
          lastPlanningImportResult: undefined,
          lastPlanningRollbackSnapshotId: snapshotId
        });
      } catch (error) {
        set({ planningRunning: false });
        useProjectStore.setState({
          error: error instanceof Error ? error.message : "Planning import rollback failed."
        });
      }
    }
  };
});
