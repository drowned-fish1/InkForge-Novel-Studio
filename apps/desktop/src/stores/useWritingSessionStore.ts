import { create } from "zustand";
import type { ScenePlan } from "@inkforge/schemas";
import { bridge } from "@/lib/browserBridge";
import { countCjkAwareWords } from "@/lib/textMetrics";
import { useProjectStore } from "@/stores/useProjectStore";
import type { WritingScene, WritingSessionState } from "@/types/app";

interface WritingSessionMetrics {
  words: number;
  tokens: number;
}

interface WritingSessionStateStore {
  scenePlans: ScenePlan[];
  session?: WritingSessionState;
  running: boolean;
  error?: string;
  hydrateScenePlans: () => void;
  addScenePlan: () => void;
  updateScenePlan: (sceneId: string, patch: Partial<ScenePlan>) => void;
  deleteScenePlan: (sceneId: string) => void;
  moveScenePlan: (sceneId: string, targetIndex: number) => void;
  startSession: () => Promise<void>;
  pauseSession: () => Promise<void>;
  resumeSession: () => Promise<void>;
  stopSession: () => Promise<void>;
  createCheckpoint: () => Promise<void>;
  rollbackCheckpoint: (checkpointId: string) => Promise<void>;
  resolveDecision: (decision: string) => Promise<void>;
  metrics: () => WritingSessionMetrics;
  resetWritingSession: () => void;
}

const storageKey = (projectPath: string, chapterId: string): string =>
  `inkforge.scenePlans.${projectPath}.${chapterId}`;

const normalizeOrder = (scenes: ScenePlan[]): ScenePlan[] => scenes.map((scene, index) => ({ ...scene, order: index }));

const createDefaultScenes = (chapterId: string, chapterTitle: string, chapterGoal: string): ScenePlan[] => [
  {
    schemaVersion: "0.1.0",
    id: `${chapterId}_scene_1`,
    chapterId,
    order: 0,
    title: "开场推进",
    location: "",
    time: "",
    goal: chapterGoal || `建立《${chapterTitle}》的开场冲突`,
    conflict: "人物目标与外部阻力第一次碰撞",
    outcome: "留下一个可承接的钩子",
    beats: [],
    requiredCharacters: [],
    worldRefs: [],
    clueRefs: [],
    decisionPoints: [],
    notes: ""
  },
  {
    schemaVersion: "0.1.0",
    id: `${chapterId}_scene_2`,
    chapterId,
    order: 1,
    title: "中段转折",
    location: "",
    time: "",
    goal: "放大阻力，并揭示一条新信息",
    conflict: "选择成本上升",
    outcome: "人物做出临时决定",
    beats: [],
    requiredCharacters: [],
    worldRefs: [],
    clueRefs: [],
    decisionPoints: [],
    notes: ""
  },
  {
    schemaVersion: "0.1.0",
    id: `${chapterId}_scene_3`,
    chapterId,
    order: 2,
    title: "收束钩子",
    location: "",
    time: "",
    goal: "完成本章最小闭环，并抛出下一章问题",
    conflict: "短期胜利与长期风险并存",
    outcome: "以明确悬念收尾",
    beats: [],
    requiredCharacters: [],
    worldRefs: [],
    clueRefs: [],
    decisionPoints: [],
    notes: ""
  }
];

const persistScenes = (scenes: ScenePlan[]): void => {
  const { project, current } = useProjectStore.getState();
  if (!project || !current) {
    return;
  }
  localStorage.setItem(storageKey(project.projectPath, current.plan.id), JSON.stringify(scenes));
};

const toWritingScenes = (scenes: ScenePlan[]): WritingScene[] =>
  scenes.map((scene) => ({
    id: scene.id,
    title: scene.title,
    goal: scene.goal || scene.outcome || scene.conflict,
    contextSummary: [scene.location, scene.time, scene.notes].filter(Boolean).join(" / "),
    expectedCharacters: scene.requiredCharacters,
    requiredTerms: scene.worldRefs,
    lockedCanon: scene.clueRefs
  }));

const estimateTokens = (text: string): number => {
  const cjk = text.match(/[\u4E00-\u9FFF\u3400-\u4DBF]/g)?.length ?? 0;
  return Math.max(0, Math.round(cjk * 0.65 + (text.length - cjk) * 0.25));
};

export const useWritingSessionStore = create<WritingSessionStateStore>((set, get) => ({
  scenePlans: [],
  running: false,
  hydrateScenePlans: () => {
    const { project, current } = useProjectStore.getState();
    if (!project || !current) {
      set({ scenePlans: [] });
      return;
    }
    const key = storageKey(project.projectPath, current.plan.id);
    try {
      const stored = JSON.parse(localStorage.getItem(key) ?? "[]") as ScenePlan[];
      set({
        scenePlans: stored.length
          ? normalizeOrder(stored)
          : createDefaultScenes(current.plan.id, current.plan.title, current.plan.goal)
      });
    } catch {
      set({ scenePlans: createDefaultScenes(current.plan.id, current.plan.title, current.plan.goal) });
    }
  },
  addScenePlan: () => {
    const { current } = useProjectStore.getState();
    if (!current) {
      return;
    }
    set((state) => {
      const scene: ScenePlan = {
        schemaVersion: "0.1.0",
        id: `${current.plan.id}_scene_${Date.now()}`,
        chapterId: current.plan.id,
        order: state.scenePlans.length,
        title: `新场景 ${state.scenePlans.length + 1}`,
        location: "",
        time: "",
        goal: "",
        conflict: "",
        outcome: "",
        beats: [],
        requiredCharacters: [],
        worldRefs: [],
        clueRefs: [],
        decisionPoints: [],
        notes: ""
      };
      const scenePlans = normalizeOrder([...state.scenePlans, scene]);
      persistScenes(scenePlans);
      return { scenePlans };
    });
  },
  updateScenePlan: (sceneId, patch) => {
    set((state) => {
      const scenePlans = normalizeOrder(
        state.scenePlans.map((scene) => (scene.id === sceneId ? { ...scene, ...patch } : scene))
      );
      persistScenes(scenePlans);
      return { scenePlans };
    });
  },
  deleteScenePlan: (sceneId) => {
    set((state) => {
      const scenePlans = normalizeOrder(state.scenePlans.filter((scene) => scene.id !== sceneId));
      persistScenes(scenePlans);
      return { scenePlans };
    });
  },
  moveScenePlan: (sceneId, targetIndex) => {
    set((state) => {
      const sourceIndex = state.scenePlans.findIndex((scene) => scene.id === sceneId);
      if (sourceIndex < 0) {
        return state;
      }
      const scenePlans = [...state.scenePlans];
      const [scene] = scenePlans.splice(sourceIndex, 1);
      scenePlans.splice(Math.max(0, Math.min(targetIndex, scenePlans.length)), 0, scene);
      const normalized = normalizeOrder(scenePlans);
      persistScenes(normalized);
      return { scenePlans: normalized };
    });
  },
  startSession: async () => {
    const scenes = get().scenePlans;
    if (!scenes.length) {
      get().hydrateScenePlans();
    }
    set({ running: true, error: undefined });
    try {
      const session = await bridge.runWritingSessionCommand({
        command: "start",
        sessionId: `writing_${Date.now()}`,
        scenes: toWritingScenes(get().scenePlans)
      });
      set({ session, running: session.status === "writing" || session.status === "review", error: undefined });
    } catch (error) {
      set({ running: false, error: error instanceof Error ? error.message : "Writing session failed to start." });
    }
  },
  pauseSession: async () => {
    const session = await bridge.runWritingSessionCommand({ command: "pause" });
    set({ session, running: false, error: undefined });
  },
  resumeSession: async () => {
    set({ running: true, error: undefined });
    try {
      const session = await bridge.runWritingSessionCommand({ command: "resume" });
      set({ session, running: session.status === "writing" || session.status === "review", error: undefined });
    } catch (error) {
      set({ running: false, error: error instanceof Error ? error.message : "Writing session resume failed." });
    }
  },
  stopSession: async () => {
    const session = await bridge.runWritingSessionCommand({ command: "stop" });
    set({ session, running: false, error: undefined });
  },
  createCheckpoint: async () => {
    const session = await bridge.runWritingSessionCommand({
      command: "checkpoint",
      checkpointLabel: "Manual checkpoint"
    });
    set({ session, error: undefined });
  },
  rollbackCheckpoint: async (checkpointId) => {
    const session = await bridge.runWritingSessionCommand({ command: "rollback", checkpointId });
    set({ session, running: false, error: undefined });
  },
  resolveDecision: async (decision) => {
    set({ running: true, error: undefined });
    try {
      const session = await bridge.runWritingSessionCommand({ command: "resolveDecision", decision });
      set({ session, running: session.status === "writing" || session.status === "review", error: undefined });
    } catch (error) {
      set({ running: false, error: error instanceof Error ? error.message : "Writing decision failed." });
    }
  },
  metrics: () => {
    const text =
      get()
        .session?.drafts.map((draft) => draft.text)
        .join("\n") ?? "";
    return {
      words: countCjkAwareWords(text),
      tokens: estimateTokens(text)
    };
  },
  resetWritingSession: () => set({ session: undefined, running: false, error: undefined })
}));
