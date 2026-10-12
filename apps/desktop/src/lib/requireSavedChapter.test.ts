import { describe, expect, it, vi } from "vitest";
import { requireSavedChapter } from "./requireSavedChapter";

describe("save before execution", () => {
  it.each(["error", "dirty", "saving"])("stops when saving ends in %s", async (saveState) => {
    const state = {
      project: { projectPath: "project" },
      current: { plan: { id: "c1" }, content: "正文" },
      saveState,
      error: "磁盘写入失败",
      saveCurrentChapter: vi.fn(async () => {})
    };
    await expect(requireSavedChapter("project", "c1", (() => state) as never)).rejects.toThrow("磁盘写入失败");
  });
  it.each(["chapter", "content"])("stops if %s changes during save", async (change) => {
    const state = {
      project: { projectPath: "project" },
      current: { plan: { id: "c1" }, content: "正文" },
      saveState: "saved",
      saveCurrentChapter: vi.fn(async () => {
        if (change === "chapter") state.current.plan.id = "c2";
        else state.current.content = "新正文";
      })
    };
    await expect(requireSavedChapter("project", "c1", (() => state) as never)).rejects.toThrow("已变化");
  });
  it("allows execution only after a successful save", async () => {
    const state = {
      project: { projectPath: "project" },
      current: { plan: { id: "c1" }, content: "正文" },
      saveState: "dirty",
      saveCurrentChapter: vi.fn(async () => {
        state.saveState = "saved";
      })
    };
    await expect(requireSavedChapter("project", "c1", (() => state) as never)).resolves.toBeUndefined();
  });
});
