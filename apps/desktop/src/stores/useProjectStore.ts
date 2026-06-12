import { create } from "zustand";
import type { ChapterPlan, Outline, VolumePlan } from "@inkforge/schemas";
import { bridge } from "@/lib/browserBridge";
import { countCjkAwareWords } from "@/lib/textMetrics";
import { useAiStore } from "@/stores/useAiStore";
import { useLibraryStore } from "@/stores/useLibraryStore";
import { usePlanningStore } from "@/stores/usePlanningStore";
import type {
  ChapterHistoryEntry,
  CreateProjectInput,
  CurrentChapter,
  ProjectListItem,
  ProjectSummary
} from "@/types/app";

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";
type ChapterStatus = ChapterPlan["status"];

interface RecoveryDraft {
  projectPath: string;
  chapterId: string;
  file: string;
  title: string;
  content: string;
  updatedAt: string;
}

export interface ImportedChapterDraft {
  title: string;
  body: string;
}

const createVolumeId = (volumes: VolumePlan[]): string => {
  const next = Math.max(0, ...volumes.map((volume) => Number(volume.id.match(/\d+$/)?.[0] ?? 0))) + 1;
  return `vol-${String(next).padStart(3, "0")}`;
};

const renumberOutline = (outline: Outline): Outline => {
  let nextChapterNumber = 1;
  return {
    ...outline,
    volumes: outline.volumes.map((volume) => ({
      ...volume,
      chapters: volume.chapters.map((chapter) => ({
        ...chapter,
        number: nextChapterNumber++
      }))
    }))
  };
};

const findChapterLocation = (
  outline: Outline,
  chapterId: string
): { volumeIndex: number; chapterIndex: number } | undefined => {
  for (const [volumeIndex, volume] of outline.volumes.entries()) {
    const chapterIndex = volume.chapters.findIndex((chapter) => chapter.id === chapterId);
    if (chapterIndex >= 0) {
      return { volumeIndex, chapterIndex };
    }
  }
  return undefined;
};

const activeChapters = (outline: Outline): ChapterPlan[] =>
  outline.volumes.flatMap((volume) => volume.chapters.filter((chapter) => !chapter.archived));

const importedChapterFile = (chapterNumber: number): string =>
  `chapters/volume-001/ch-${String(chapterNumber).padStart(4, "0")}.md`;

const recoveryDraftKey = (projectPath: string, file: string): string =>
  `inkforge.recovery.chapter.v1:${encodeURIComponent(projectPath)}:${encodeURIComponent(file)}`;

const readRecoveryDraft = (projectPath: string, file: string): RecoveryDraft | undefined => {
  if (typeof window === "undefined") {
    return undefined;
  }
  try {
    const raw = window.localStorage.getItem(recoveryDraftKey(projectPath, file));
    return raw ? (JSON.parse(raw) as RecoveryDraft) : undefined;
  } catch {
    return undefined;
  }
};

const writeRecoveryDraft = (projectPath: string, chapter: ChapterPlan, content: string): void => {
  if (typeof window === "undefined") {
    return;
  }
  const draft: RecoveryDraft = {
    projectPath,
    chapterId: chapter.id,
    file: chapter.file,
    title: chapter.title,
    content,
    updatedAt: new Date().toISOString()
  };
  window.localStorage.setItem(recoveryDraftKey(projectPath, chapter.file), JSON.stringify(draft));
};

const clearRecoveryDraft = (projectPath: string, file: string): void => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(recoveryDraftKey(projectPath, file));
};

const delay = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));

const withSaveRetry = async <T>(operation: () => Promise<T>, attempts = 3): Promise<T> => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await delay(150 * attempt);
      }
    }
  }
  throw lastError;
};

interface ProjectState {
  project?: ProjectSummary;
  recentProjects: ProjectListItem[];
  current?: CurrentChapter;
  selectedModule: string;
  focusMode: boolean;
  recentChapterIds: string[];
  chapterHistory: ChapterHistoryEntry[];
  selectedHistoryId?: string;
  historyPreview?: string;
  saveState: SaveState;
  lastSavedAt?: string;
  error?: string;
  setSelectedModule: (module: string) => void;
  setFocusMode: (enabled: boolean) => void;
  loadRecentProjects: () => Promise<void>;
  createProject: (input: CreateProjectInput) => Promise<void>;
  createImportedProject: (input: CreateProjectInput, chapters: ImportedChapterDraft[]) => Promise<void>;
  importProjectFolder: () => Promise<void>;
  openProject: (projectPath?: string) => Promise<void>;
  closeProject: () => Promise<void>;
  selectChapter: (chapter: ChapterPlan) => Promise<void>;
  updateContent: (content: string) => void;
  saveCurrentChapter: () => Promise<void>;
  loadChapterHistory: () => Promise<void>;
  previewChapterHistory: (historyId: string) => Promise<void>;
  restoreChapterHistory: (historyId: string) => Promise<void>;
  createChapter: (volumeId?: string) => Promise<void>;
  updateOutline: (outline: Outline) => Promise<void>;
  createVolume: () => Promise<void>;
  renameVolume: (volumeId: string, title: string) => Promise<void>;
  deleteVolume: (volumeId: string) => Promise<void>;
  updateChapterPlan: (chapterId: string, patch: Partial<ChapterPlan>) => Promise<void>;
  moveChapter: (chapterId: string, targetVolumeId: string, targetIndex?: number) => Promise<void>;
  deleteChapterPlan: (chapterId: string) => Promise<void>;
  archiveChapter: (chapterId: string) => Promise<void>;
  exportManuscript: (format: "markdown" | "txt" | "docx") => Promise<string | undefined>;
}

const flushCurrentChapterIfNeeded = async (get: () => ProjectState): Promise<boolean> => {
  const state = get();
  if (state.saveState !== "dirty" && state.saveState !== "error") {
    return true;
  }
  await state.saveCurrentChapter();
  if (get().saveState === "error") {
    return false;
  }
  return true;
};

export const useProjectStore = create<ProjectState>((set, get) => ({
  selectedModule: "chapters",
  focusMode: false,
  saveState: "idle",
  recentProjects: [],
  recentChapterIds: [],
  chapterHistory: [],
  setSelectedModule: (module) => set({ selectedModule: module }),
  setFocusMode: (enabled) => set({ focusMode: enabled }),
  loadRecentProjects: async () => {
    set({ recentProjects: await bridge.listProjects() });
  },
  createProject: async (input) => {
    if (!(await flushCurrentChapterIfNeeded(get))) {
      return;
    }
    const project = await bridge.createProject(input);
    if (!project) {
      return;
    }
    set({ project, selectedModule: "chapters", error: undefined });
    await useLibraryStore.getState().loadLibraries();
    const first = project.outline.volumes[0]?.chapters[0];
    if (first) {
      await get().selectChapter(first);
    }
    await get().loadRecentProjects();
  },
  createImportedProject: async (input, chapters) => {
    if (!(await flushCurrentChapterIfNeeded(get))) {
      return;
    }
    const project = await bridge.createProject(input);
    if (!project) {
      return;
    }

    const importedChapters: ChapterPlan[] = chapters.map((chapter, index) => {
      const number = index + 1;
      const content = `# ${chapter.title}\n\n${chapter.body.trim()}\n`;
      return {
        id: `ch-${String(number).padStart(4, "0")}`,
        number,
        title: chapter.title,
        file: importedChapterFile(number),
        goal: "",
        hook: "",
        status: "drafting",
        targetWords: project.meta.writingPreferences.chapterWords,
        actualWords: countCjkAwareWords(content),
        archived: false,
        notes: "",
        conflictPoints: "",
        characters: [],
        worldRefs: []
      };
    });

    const outline = {
      ...project.outline,
      volumes: [
        {
          id: "vol-001",
          title: project.outline.volumes[0]?.title ?? "第一卷",
          goal: project.outline.volumes[0]?.goal ?? "",
          targetWords: Math.max(90000, importedChapters.length * project.meta.writingPreferences.chapterWords),
          chapters: importedChapters
        }
      ]
    };
    const next = await bridge.updateOutline({ projectPath: project.projectPath, outline });
    await Promise.all(
      importedChapters.map((chapter, index) =>
        bridge.saveChapter({
          projectPath: next.projectPath,
          file: chapter.file,
          content: `# ${chapter.title}\n\n${chapters[index].body.trim()}\n`
        })
      )
    );

    set({ project: next, selectedModule: "chapters", error: undefined });
    await useLibraryStore.getState().loadLibraries();
    const first = next.outline.volumes[0]?.chapters[0];
    if (first) {
      await get().selectChapter(first);
    }
    await get().loadRecentProjects();
  },
  importProjectFolder: async () => {
    if (!(await flushCurrentChapterIfNeeded(get))) {
      return;
    }
    const project = await bridge.importProjectFolder();
    if (!project) {
      return;
    }
    set({ project, selectedModule: "chapters", error: undefined });
    await useLibraryStore.getState().loadLibraries();
    const first = project.outline.volumes[0]?.chapters[0];
    if (first) {
      await get().selectChapter(first);
    }
    await get().loadRecentProjects();
  },
  openProject: async (projectPath?: string) => {
    if (!(await flushCurrentChapterIfNeeded(get))) {
      return;
    }
    const project = await bridge.openProject(projectPath);
    if (!project) {
      return;
    }
    set({ project, selectedModule: "chapters", error: undefined });
    await useLibraryStore.getState().loadLibraries();
    const first = project.outline.volumes[0]?.chapters[0];
    if (first) {
      await get().selectChapter(first);
    }
    await get().loadRecentProjects();
  },
  closeProject: async () => {
    if (!(await flushCurrentChapterIfNeeded(get))) {
      return;
    }
    set({
      project: undefined,
      current: undefined,
      chapterHistory: [],
      selectedHistoryId: undefined,
      historyPreview: undefined,
      selectedModule: "chapters",
      focusMode: false,
      saveState: "idle",
      error: undefined
    });
    useAiStore.getState().resetAi();
    useLibraryStore.getState().resetLibraries();
    usePlanningStore.getState().resetPlanning();
  },
  selectChapter: async (chapter) => {
    const project = get().project;
    if (!project) {
      return;
    }
    if (get().current?.plan.id !== chapter.id) {
      if (!(await flushCurrentChapterIfNeeded(get))) {
        return;
      }
    }
    const content = await bridge.readChapter(project.projectPath, chapter.file);
    const recovery = readRecoveryDraft(project.projectPath, chapter.file);
    const recoveredContent = recovery?.content && recovery.content !== content ? recovery.content : undefined;
    set((state) => ({
      current: { plan: chapter, content: recoveredContent ?? content },
      saveState: recoveredContent ? "dirty" : "saved",
      selectedModule: "chapters",
      selectedHistoryId: undefined,
      historyPreview: undefined,
      recentChapterIds: [chapter.id, ...state.recentChapterIds.filter((id) => id !== chapter.id)].slice(0, 8),
      error: recoveredContent ? `已恢复「${chapter.title}」的未保存草稿，请确认后保存。` : undefined
    }));
    await get().loadChapterHistory();
  },
  updateContent: (content) => {
    const { project, current } = get();
    if (project && current) {
      writeRecoveryDraft(project.projectPath, current.plan, content);
    }
    set((state) => ({
      current: state.current ? { ...state.current, content } : undefined,
      saveState: "dirty"
    }));
  },
  saveCurrentChapter: async () => {
    const { project, current } = get();
    if (!project || !current) {
      return;
    }
    set({ saveState: "saving" });
    try {
      await withSaveRetry(() =>
        bridge.saveChapter({
          projectPath: project.projectPath,
          file: current.plan.file,
          content: current.content
        })
      );
      await withSaveRetry(() =>
        get().updateChapterPlan(current.plan.id, { actualWords: countCjkAwareWords(current.content) })
      );
      clearRecoveryDraft(project.projectPath, current.plan.file);
      set({ saveState: "saved", lastSavedAt: new Date().toLocaleTimeString(), error: undefined });
      await get().loadChapterHistory();
    } catch (error) {
      set({ saveState: "error", error: error instanceof Error ? error.message : "保存失败" });
    }
  },
  loadChapterHistory: async () => {
    const { project, current } = get();
    if (!project || !current) {
      set({ chapterHistory: [], selectedHistoryId: undefined, historyPreview: undefined });
      return;
    }
    const chapterHistory = await bridge.listChapterHistory(project.projectPath, current.plan.file);
    set((state) => ({
      chapterHistory,
      selectedHistoryId: chapterHistory.some((entry) => entry.id === state.selectedHistoryId)
        ? state.selectedHistoryId
        : undefined,
      historyPreview: chapterHistory.some((entry) => entry.id === state.selectedHistoryId)
        ? state.historyPreview
        : undefined
    }));
  },
  previewChapterHistory: async (historyId) => {
    const { project, current } = get();
    if (!project || !current) {
      return;
    }
    const historyPreview = await bridge.readChapterHistory(project.projectPath, current.plan.file, historyId);
    set({ selectedHistoryId: historyId, historyPreview });
  },
  restoreChapterHistory: async (historyId) => {
    const { project, current } = get();
    if (!project || !current) {
      return;
    }
    set({ saveState: "saving", error: undefined });
    try {
      const content = await bridge.restoreChapterHistory(project.projectPath, current.plan.file, historyId);
      clearRecoveryDraft(project.projectPath, current.plan.file);
      set((state) => ({
        current: state.current ? { ...state.current, content } : undefined,
        saveState: "saved",
        lastSavedAt: new Date().toLocaleTimeString(),
        selectedHistoryId: undefined,
        historyPreview: undefined,
        error: undefined
      }));
      await get().updateChapterPlan(current.plan.id, { actualWords: countCjkAwareWords(content) });
      await get().loadChapterHistory();
    } catch (error) {
      set({ saveState: "error", error: error instanceof Error ? error.message : "鍘嗗彶鐗堟湰鎭㈠澶辫触" });
    }
  },
  createChapter: async (preferredVolumeId) => {
    if (!(await flushCurrentChapterIfNeeded(get))) {
      return;
    }
    const { project } = get();
    const volumeId = preferredVolumeId ?? project?.outline.volumes[0]?.id;
    if (!project || !volumeId) {
      return;
    }
    const next = await bridge.createChapter({ projectPath: project.projectPath, volumeId });
    set({ project: next, error: undefined });
    const latest = next.outline.volumes.flatMap((volume) => volume.chapters).at(-1);
    if (latest) {
      await get().selectChapter(latest);
    }
    await get().loadRecentProjects();
  },
  updateOutline: async (outline) => {
    const project = get().project;
    if (!project) {
      return;
    }
    const normalizedOutline = renumberOutline(outline);
    const next = await bridge.updateOutline({ projectPath: project.projectPath, outline: normalizedOutline });
    set((state) => {
      const refreshedCurrent = state.current
        ? next.outline.volumes
            .flatMap((volume) => volume.chapters)
            .find((chapter) => chapter.id === state.current?.plan.id)
        : undefined;
      return {
        project: next,
        current: state.current && refreshedCurrent ? { ...state.current, plan: refreshedCurrent } : state.current,
        error: undefined
      };
    });
    await get().loadRecentProjects();
  },
  createVolume: async () => {
    const { project } = get();
    if (!project) {
      return;
    }
    const id = createVolumeId(project.outline.volumes);
    const nextVolume: VolumePlan = {
      id,
      title: `第${project.outline.volumes.length + 1}卷`,
      goal: "",
      targetWords: 90000,
      chapters: []
    };
    await get().updateOutline({
      ...project.outline,
      volumes: [...project.outline.volumes, nextVolume]
    });
  },
  renameVolume: async (volumeId, title) => {
    const { project } = get();
    const nextTitle = title.trim();
    if (!project || !nextTitle) {
      return;
    }
    await get().updateOutline({
      ...project.outline,
      volumes: project.outline.volumes.map((volume) =>
        volume.id === volumeId ? { ...volume, title: nextTitle } : volume
      )
    });
  },
  deleteVolume: async (volumeId) => {
    const { project } = get();
    if (!project || project.outline.volumes.length <= 1) {
      return;
    }
    const removed = project.outline.volumes.find((volume) => volume.id === volumeId);
    if (!removed) {
      return;
    }
    const remaining = project.outline.volumes.filter((volume) => volume.id !== volumeId);
    await get().updateOutline({ ...project.outline, volumes: remaining });
    if (removed.chapters.some((chapter) => chapter.id === get().current?.plan.id)) {
      const first = activeChapters({ ...project.outline, volumes: remaining })[0];
      set({ current: undefined });
      if (first) {
        await get().selectChapter(first);
      }
    }
  },
  updateChapterPlan: async (chapterId, patch) => {
    const { project } = get();
    if (!project) {
      return;
    }
    let nextCurrentPlan: ChapterPlan | undefined;
    const outline = {
      ...project.outline,
      volumes: project.outline.volumes.map((volume) => ({
        ...volume,
        chapters: volume.chapters.map((chapter) => {
          if (chapter.id !== chapterId) {
            return chapter;
          }
          const next = { ...chapter, ...patch };
          nextCurrentPlan = next;
          return next;
        })
      }))
    };
    await get().updateOutline(outline);
    if (nextCurrentPlan && get().current?.plan.id === chapterId) {
      const refreshedPlan = nextCurrentPlan;
      set((state) => ({
        current: state.current ? { ...state.current, plan: refreshedPlan } : undefined
      }));
    }
  },
  moveChapter: async (chapterId, targetVolumeId, targetIndex) => {
    if (!(await flushCurrentChapterIfNeeded(get))) {
      return;
    }
    const { project } = get();
    if (!project) {
      return;
    }
    const outline = structuredClone(project.outline);
    const source = findChapterLocation(outline, chapterId);
    const targetVolumeIndex = outline.volumes.findIndex((volume) => volume.id === targetVolumeId);
    if (!source || targetVolumeIndex < 0) {
      return;
    }
    const [chapter] = outline.volumes[source.volumeIndex].chapters.splice(source.chapterIndex, 1);
    const targetChapters = outline.volumes[targetVolumeIndex].chapters;
    const insertionIndex = Math.max(0, Math.min(targetIndex ?? targetChapters.length, targetChapters.length));
    targetChapters.splice(insertionIndex, 0, chapter);
    await get().updateOutline(outline);
  },
  deleteChapterPlan: async (chapterId) => {
    const { project } = get();
    if (!project) {
      return;
    }
    const outline = {
      ...project.outline,
      volumes: project.outline.volumes.map((volume) => ({
        ...volume,
        chapters: volume.chapters.filter((chapter) => chapter.id !== chapterId)
      }))
    };
    await get().updateOutline(outline);
    if (get().current?.plan.id === chapterId) {
      const first = activeChapters(outline)[0];
      set({ current: undefined });
      if (first) {
        await get().selectChapter(first);
      }
    }
  },
  archiveChapter: async (chapterId) => {
    await get().updateChapterPlan(chapterId, { archived: true, status: "done" as ChapterStatus });
    if (get().current?.plan.id === chapterId) {
      const project = get().project;
      const first = project ? activeChapters(project.outline).find((chapter) => chapter.id !== chapterId) : undefined;
      set({ current: undefined });
      if (first) {
        await get().selectChapter(first);
      }
    }
  },
  exportManuscript: async (format) => {
    const { project } = get();
    if (!project) {
      return undefined;
    }
    return bridge.exportManuscript({
      projectPath: project.projectPath,
      format,
      includeChapterTitles: true,
      includeVolumeTitles: true
    });
  }
}));
