import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChapterPlan } from "@inkforge/schemas";
import type { ProjectSummary } from "../types/app";

const bridgeMock = vi.hoisted(() => ({
  saveChapter: vi.fn(),
  readChapter: vi.fn(),
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
