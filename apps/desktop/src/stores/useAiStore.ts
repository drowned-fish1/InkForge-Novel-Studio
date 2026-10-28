import { create } from "zustand";
import { bridge } from "@/lib/browserBridge";
import { useLibraryStore } from "@/stores/useLibraryStore";
import { useProjectStore } from "@/stores/useProjectStore";
import type { AiTaskResult } from "@/types/app";

interface AiDraftEntry {
  id: string;
  result: AiTaskResult;
  appended: boolean;
  streaming?: boolean;
  savedAsSummaryPath?: string;
}

const MAX_DRAFTS = 20;

const estimateTokens = (text: string): number => {
  const cjk = text.match(/[\u4E00-\u9FFF\u3400-\u4DBF]/g)?.length ?? 0;
  const other = text.length - cjk;
  return Math.round(cjk * 0.65 + other * 0.25);
};

const isAbortError = (error: unknown): boolean =>
  (error instanceof DOMException && error.name === "AbortError") ||
  (error instanceof Error && error.name === "AbortError");

const createStreamingResult = (task: AiTaskResult["task"], model: string, providerId: string): AiTaskResult => ({
  task,
  text: "",
  providerId,
  model,
  contextSummary: "正在流式生成...",
  generatedAt: new Date().toISOString()
});

interface AiState {
  aiDrafts: AiDraftEntry[];
  aiRunning: boolean;
  lastSummaryPath?: string;
  sessionTokens: number;
  resetAi: () => void;
  runAiTask: (task: AiTaskResult["task"], instruction?: string) => Promise<void>;
  followUpDraft: (draftId: string, instruction: string) => Promise<void>;
  cancelAiTask: () => void;
  appendDraftToChapter: (draftId: string) => Promise<void>;
  saveDraftAsSummary: (draftId: string) => Promise<void>;
  removeDraft: (draftId: string) => void;
  clearAllDrafts: () => void;
}

export const useAiStore = create<AiState>((set, get) => {
  let abortController: AbortController | null = null;

  return {
    aiDrafts: [],
    aiRunning: false,
    sessionTokens: 0,
    resetAi: () => {
      abortController?.abort();
      abortController = null;
      set({ aiDrafts: [], aiRunning: false, lastSummaryPath: undefined, sessionTokens: 0 });
    },
    cancelAiTask: () => {
      abortController?.abort();
      abortController = null;
      set({ aiRunning: false });
    },
    runAiTask: async (task, instruction) => {
      const { current, project } = useProjectStore.getState();
      const { characters, worldEntries } = useLibraryStore.getState();
      if (!current || !project) {
        return;
      }
      abortController?.abort();
      abortController = new AbortController();
      const draftId = `draft_${Date.now()}`;
      const streamingEntry: AiDraftEntry = {
        id: draftId,
        result: createStreamingResult(task, "streaming", "pending"),
        appended: false,
        streaming: true
      };
      set({ aiRunning: true });
      set((state) => ({ aiDrafts: [streamingEntry, ...state.aiDrafts].slice(0, MAX_DRAFTS) }));
      useProjectStore.setState({ error: undefined });
      try {
        const isDeepInspect = task === "ai-inspect";
        const result = await bridge.runAiTask(
          {
            requestId: draftId,
            projectPath: project.projectPath,
            task,
            instruction,
            chapterTitle: current.plan.title,
            chapterId: current.plan.id,
            chapterGoal: current.plan.goal,
            recentText: isDeepInspect ? "" : current.content.slice(-5000),
            characters: (isDeepInspect ? characters : characters.slice(0, 8)).map(
              (item) => `${item.name}：${item.profile.identity}：${item.currentState.powerLevel}`
            ),
            worldFacts: (isDeepInspect ? worldEntries : worldEntries.slice(0, 8)).map(
              (item) => `${item.title}：${item.summary || item.content.slice(0, 80)}`
            ),
            style: project.meta.writingPreferences.style
          },
          abortController.signal,
          (chunk) => {
            set((state) => ({
              aiDrafts: state.aiDrafts.map((entry) =>
                entry.id === draftId
                  ? { ...entry, result: { ...entry.result, text: `${entry.result.text}${chunk}` } }
                  : entry
              )
            }));
          }
        );
        if (abortController.signal.aborted) {
          return;
        }
        abortController = null;
        const tokenDelta = result.usage?.totalTokens ?? estimateTokens(result.text);
        set((state) => ({
          aiDrafts: state.aiDrafts.map((entry) =>
            entry.id === draftId ? { ...entry, result, streaming: false } : entry
          ),
          aiRunning: false,
          lastSummaryPath: undefined,
          sessionTokens: state.sessionTokens + tokenDelta
        }));
      } catch (error) {
        if (isAbortError(error)) {
          abortController = null;
          set((state) => ({
            aiRunning: false,
            aiDrafts: state.aiDrafts
              .filter((entry) => entry.id !== draftId || entry.result.text.trim())
              .map((entry) => (entry.id === draftId ? { ...entry, streaming: false } : entry))
          }));
          return;
        }
        abortController = null;
        set((state) => ({
          aiRunning: false,
          aiDrafts: state.aiDrafts
            .filter((entry) => entry.id !== draftId || entry.result.text.trim())
            .map((entry) => (entry.id === draftId ? { ...entry, streaming: false } : entry))
        }));
        useProjectStore.setState({ error: error instanceof Error ? error.message : "AI 请求失败" });
      }
    },
    followUpDraft: async (draftId, instruction) => {
      const entry = get().aiDrafts.find((d) => d.id === draftId);
      const { current, project } = useProjectStore.getState();
      const { characters, worldEntries } = useLibraryStore.getState();
      if (!entry || !current || !project) {
        return;
      }
      abortController?.abort();
      abortController = new AbortController();
      const streamingDraftId = `draft_${Date.now()}`;
      const streamingEntry: AiDraftEntry = {
        id: streamingDraftId,
        result: createStreamingResult(entry.result.task, entry.result.model, entry.result.providerId),
        appended: false,
        streaming: true
      };
      set({ aiRunning: true });
      set((state) => ({ aiDrafts: [streamingEntry, ...state.aiDrafts].slice(0, MAX_DRAFTS) }));
      useProjectStore.setState({ error: undefined });
      try {
        const result = await bridge.runAiTask(
          {
            requestId: streamingDraftId,
            projectPath: project.projectPath,
            task: entry.result.task,
            instruction: `Follow-up: ${instruction}\n\nPrevious output:\n${entry.result.text.slice(0, 3000)}`,
            chapterTitle: current.plan.title,
            chapterId: current.plan.id,
            chapterGoal: current.plan.goal,
            recentText: current.content.slice(-3000),
            characters: characters
              .slice(0, 8)
              .map((item) => `${item.name}：${item.profile.identity}：${item.currentState.powerLevel}`),
            worldFacts: worldEntries
              .slice(0, 8)
              .map((item) => `${item.title}：${item.summary || item.content.slice(0, 80)}`),
            style: project.meta.writingPreferences.style
          },
          abortController.signal,
          (chunk) => {
            set((state) => ({
              aiDrafts: state.aiDrafts.map((item) =>
                item.id === streamingDraftId
                  ? { ...item, result: { ...item.result, text: `${item.result.text}${chunk}` } }
                  : item
              )
            }));
          }
        );
        if (abortController.signal.aborted) {
          return;
        }
        const tokenDelta = result.usage?.totalTokens ?? estimateTokens(result.text);
        abortController = null;
        set((state) => ({
          aiDrafts: state.aiDrafts.map((item) =>
            item.id === streamingDraftId ? { ...item, result, streaming: false } : item
          ),
          aiRunning: false,
          sessionTokens: state.sessionTokens + tokenDelta
        }));
      } catch (error) {
        if (isAbortError(error)) {
          abortController = null;
          set((state) => ({
            aiRunning: false,
            aiDrafts: state.aiDrafts
              .filter((item) => item.id !== streamingDraftId || item.result.text.trim())
              .map((item) => (item.id === streamingDraftId ? { ...item, streaming: false } : item))
          }));
          return;
        }
        abortController = null;
        set((state) => ({
          aiRunning: false,
          aiDrafts: state.aiDrafts
            .filter((item) => item.id !== streamingDraftId || item.result.text.trim())
            .map((item) => (item.id === streamingDraftId ? { ...item, streaming: false } : item))
        }));
        useProjectStore.setState({ error: error instanceof Error ? error.message : "AI 请求失败" });
      }
    },
    appendDraftToChapter: async (draftId) => {
      const entry = get().aiDrafts.find((d) => d.id === draftId);
      const projectStore = useProjectStore.getState();
      const { current } = projectStore;
      if (!current || !entry) {
        return;
      }
      if (entry.streaming) {
        return;
      }
      const nextContent = `${current.content.trimEnd()}\n\n${entry.result.text.trim()}\n`;
      projectStore.updateContent(nextContent);
      await useProjectStore.getState().saveCurrentChapter();
      set((state) => ({
        aiDrafts: state.aiDrafts.map((d) => (d.id === draftId ? { ...d, appended: true } : d))
      }));
    },
    saveDraftAsSummary: async (draftId) => {
      const entry = get().aiDrafts.find((d) => d.id === draftId);
      const { project, current } = useProjectStore.getState();
      if (!project || !current || !entry) {
        return;
      }
      if (entry.streaming) {
        return;
      }
      const relativePath = await bridge.saveChapterSummary({
        projectPath: project.projectPath,
        chapterId: current.plan.id,
        chapterTitle: current.plan.title,
        result: entry.result
      });
      set((state) => ({
        lastSummaryPath: relativePath,
        aiDrafts: state.aiDrafts.map((d) => (d.id === draftId ? { ...d, savedAsSummaryPath: relativePath } : d))
      }));
      useProjectStore.setState({ error: undefined });
    },
    removeDraft: (draftId) => {
      set((state) => ({
        aiDrafts: state.aiDrafts.filter((d) => d.id !== draftId)
      }));
    },
    clearAllDrafts: () => set({ aiDrafts: [], lastSummaryPath: undefined })
  };
});
