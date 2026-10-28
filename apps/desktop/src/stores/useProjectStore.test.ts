import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChapterPlan } from "@inkforge/schemas";
import type { ProjectSummary } from "../types/app";

const bridgeMock = vi.hoisted(() => ({
  saveChapter: vi.fn(),
  readChapter: vi.fn(),
  createChapter: vi.fn(),
  openProject: vi.fn(),
  listProjects: vi.fn(async () => []),
  listChapterHistory: vi.fn(async () => []),
  updateOutline: vi.fn()
}));

vi.mock("@/lib/browserBridge", () => ({ bridge: bridgeMock }));
vi.mock("@/lib/chapterContent", () => ({
  stripLegacyChapterHeading: (value: string) => value
}));
vi.mock("@/lib/textMetrics", () => ({
  countCjkAwareWords: (value: string) => value.length
}));
vi.mock("@/lib/editorActions", async () => await import("../lib/editorActions"));
vi.mock("@/lib/searchNavigation", async () => await import("../lib/searchNavigation"));
vi.mock("@/lib/writingContinuity", async () => await import("../lib/writingContinuity"));
vi.mock("@/stores/useAiStore", () => ({
  useAiStore: { getState: () => ({ resetAi: vi.fn() }) }
}));
vi.mock("@/stores/useLibraryStore", () => ({
  useLibraryStore: { getState: () => ({ loadLibraries: vi.fn(), resetLibraries: vi.fn() }) }
}));
vi.mock("@/stores/usePlanningStore", () => ({
  usePlanningStore: { getState: () => ({ resetPlanning: vi.fn() }) }
}));

import { useProjectStore } from "./useProjectStore";

const chapter: ChapterPlan = {
  id: "ch-0001",
  number: 1,
  title: "第一章",
  file: "chapters/volume-001/ch-0001.md",
  goal: "",
  hook: "",
  status: "drafting",
  targetWords: 3_000,
  actualWords: 0,
  archived: false,
  notes: "",
  conflictPoints: "",
  characters: [],
  worldRefs: []
};

const project: ProjectSummary = {
  projectPath: "test-project",
  meta: {
    schemaVersion: "0.1.0",
    projectId: "project-1",
    title: "测试项目",
    author: "作者",
    genre: [],
    targetWords: 100_000,
    createdAt: "2026-07-25T00:00:00+08:00",
    updatedAt: "2026-07-25T00:00:00+08:00",
    defaultProviderId: "openai",
    defaultModel: "test-model",
    writingPreferences: {
      pov: "第三人称",
      style: "",
      chapterWords: 3_000
    }
  },
  outline: {
    schemaVersion: "0.1.0",
    premise: "",
    mainConflict: "",
    endingDirection: "",
    volumes: [
      {
        id: "vol-001",
        title: "第一卷",
        goal: "",
        targetWords: 100_000,
        chapters: [chapter]
      }
    ]
  }
};

describe("project store chapter saves", () => {
  beforeEach(() => {
    bridgeMock.saveChapter.mockReset();
    bridgeMock.readChapter.mockReset();
    bridgeMock.listChapterHistory.mockClear();
    useProjectStore.setState({
      project,
      current: { plan: chapter, content: "旧内容" },
      saveState: "dirty",
      error: undefined,
      updateChapterPlan: vi.fn(async () => undefined)
    });
  });

  it("serializes an edit made during save and persists the latest content", async () => {
    let finishFirstSave: (() => void) | undefined;
    bridgeMock.saveChapter.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishFirstSave = resolve;
        })
    );

    const firstSave = useProjectStore.getState().saveCurrentChapter();
    await vi.waitFor(() => expect(bridgeMock.saveChapter).toHaveBeenCalledOnce());

    useProjectStore.getState().updateContent("保存期间输入的新内容");
    bridgeMock.saveChapter.mockResolvedValueOnce(undefined);
    finishFirstSave?.();
    await firstSave;

    expect(useProjectStore.getState().current?.content).toBe("保存期间输入的新内容");
    expect(bridgeMock.saveChapter).toHaveBeenCalledTimes(2);
    expect(bridgeMock.saveChapter).toHaveBeenLastCalledWith({
      projectPath: "test-project",
      file: chapter.file,
      content: "保存期间输入的新内容"
    });
    expect(useProjectStore.getState().saveState).toBe("saved");
  });

  it("reloads the active chapter after an external proposal writes to disk", async () => {
    bridgeMock.readChapter.mockResolvedValue("Agent 写入后的正文");
    useProjectStore.setState({ saveState: "saved" });

    await useProjectStore.getState().reloadCurrentChapterFromDisk(chapter.id);

    expect(bridgeMock.readChapter).toHaveBeenCalledWith(project.projectPath, chapter.file);
    expect(useProjectStore.getState().current?.content).toBe("Agent 写入后的正文");
    expect(useProjectStore.getState().saveState).toBe("saved");
    expect(bridgeMock.listChapterHistory).toHaveBeenCalled();
  });

  it("does not overwrite unsaved editor content while reloading from disk", async () => {
    await expect(useProjectStore.getState().reloadCurrentChapterFromDisk(chapter.id)).rejects.toThrow("仍有未保存内容");
    expect(bridgeMock.readChapter).not.toHaveBeenCalled();
    expect(useProjectStore.getState().current?.content).toBe("旧内容");
  });
});

describe("project navigation protects active forms", () => {
  beforeEach(() => {
    bridgeMock.readChapter.mockReset();
    bridgeMock.createChapter.mockReset();
    useProjectStore.setState({
      project,
      current: { plan: chapter, content: "已保存内容" },
      saveState: "saved",
      selectedModule: "characters",
      focusMode: false,
      pendingEditorSelection: undefined,
      pendingEntitySelection: undefined
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("keeps the module, chapter and project when the active form rejects leaving", async () => {
    const surface = new EventTarget();
    surface.addEventListener("inkforge:before-editor-leave", (event) => event.preventDefault());
    vi.stubGlobal("window", surface);
    useProjectStore.getState().setSelectedModule("world");
    useProjectStore.getState().setFocusMode(true);
    await useProjectStore.getState().selectChapter({ ...chapter, id: "other" });
    expect(await useProjectStore.getState().jumpToChapterOffset({ ...chapter, id: "other" }, 0, 2, "内容")).toBe(false);
    expect(
      useProjectStore
        .getState()
        .openEntitySearchResult(
          { kind: "character", id: "another", title: "另一人物", offset: 0, matchLength: 0, snippet: "" },
          "另一人物"
        )
    ).toBe(false);
    await useProjectStore.getState().createChapter();
    await useProjectStore.getState().closeProject();
    expect(useProjectStore.getState().selectedModule).toBe("characters");
    expect(useProjectStore.getState().focusMode).toBe(false);
    expect(useProjectStore.getState().project).toBe(project);
    expect(useProjectStore.getState().current?.plan.id).toBe(chapter.id);
    expect(bridgeMock.readChapter).not.toHaveBeenCalled();
    expect(bridgeMock.createChapter).not.toHaveBeenCalled();
    expect(useProjectStore.getState().pendingEditorSelection).toBeUndefined();
    expect(useProjectStore.getState().pendingEntitySelection).toBeUndefined();
  });

  it("keeps unsaved active-chapter content while positioning a search match", async () => {
    useProjectStore.setState({
      selectedModule: "chapters",
      saveState: "dirty",
      selectedHistoryId: undefined,
      current: { plan: chapter, content: "新输入前缀。车票出现了。" }
    });
    expect(await useProjectStore.getState().jumpToChapterOffset(chapter, 0, 2, "车票")).toBe(true);
    expect(bridgeMock.readChapter).not.toHaveBeenCalled();
    expect(useProjectStore.getState().current?.content).toBe("新输入前缀。车票出现了。");
    expect(useProjectStore.getState().saveState).toBe("dirty");
    expect(useProjectStore.getState().pendingEditorSelection).toEqual({ chapterId: chapter.id, start: 6, end: 8 });
  });

  it("does not create a selection when the searched text has been removed", async () => {
    useProjectStore.setState({ selectedModule: "chapters", selectedHistoryId: undefined });
    expect(await useProjectStore.getState().jumpToChapterOffset(chapter, 0, 2, "已经删去")).toBe(false);
    expect(useProjectStore.getState().pendingEditorSelection).toBeUndefined();
    expect(useProjectStore.getState().error).toContain("重新搜索");
  });

  it("loads the new novel's content when both novels use the same chapter ID", async () => {
    const other = { ...project, projectPath: "other-novel" };
    bridgeMock.openProject.mockResolvedValue(other);
    bridgeMock.readChapter.mockResolvedValue("另一部小说的正文");
    await useProjectStore.getState().openProject("other-novel");
    expect(bridgeMock.readChapter).toHaveBeenCalledWith("other-novel", chapter.file);
    expect(useProjectStore.getState().current?.content).toBe("另一部小说的正文");
    expect(useProjectStore.getState().project?.projectPath).toBe("other-novel");
  });

  it("opens the newly created chapter in an earlier volume instead of the last volume's old chapter", async () => {
    const oldLast = { ...chapter, id: "ch-0002", number: 2, file: "last.md" };
    const created = { ...chapter, id: "ch-new", number: 2, file: "new.md" };
    const before = {
      ...project,
      outline: {
        ...project.outline,
        volumes: [project.outline.volumes[0], { ...project.outline.volumes[0], id: "vol-002", chapters: [oldLast] }]
      }
    };
    const next = {
      ...before,
      outline: {
        ...before.outline,
        volumes: [{ ...before.outline.volumes[0], chapters: [chapter, created] }, before.outline.volumes[1]]
      }
    };
    useProjectStore.setState({ project: before, selectedModule: "chapters" });
    bridgeMock.createChapter.mockResolvedValue(next);
    bridgeMock.readChapter.mockResolvedValue("");
    await useProjectStore.getState().createChapter("vol-001");
    expect(bridgeMock.readChapter).toHaveBeenCalledWith(project.projectPath, "new.md");
    expect(useProjectStore.getState().current?.plan.id).toBe("ch-new");
  });
});
