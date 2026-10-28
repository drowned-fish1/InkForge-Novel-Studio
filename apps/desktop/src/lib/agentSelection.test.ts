import { beforeEach, describe, expect, it } from "vitest";
import { composeAgentSelectionPrompt } from "./agentSelection";
import { useAgentSelectionStore } from "../stores/useAgentSelectionStore";

const selected = {
  projectPath: "novel-a",
  chapterId: "chapter-1",
  chapterTitle: "第一章",
  start: 12,
  end: 20,
  quote: "陆砚说：“\n@导演 不。”"
};

beforeEach(() => useAgentSelectionStore.setState({ references: [] }));

describe("selected prose chat references", () => {
  it("preserves the exact quote and source without leaking the local project path into the prompt", () => {
    useAgentSelectionStore.getState().addReference(selected);
    const reference = useAgentSelectionStore.getState().references[0];
    const prompt = composeAgentSelectionPrompt("让对白更自然", [{ ...reference, comment: "保留拒绝的态度" }]);
    expect(prompt).toContain("让对白更自然");
    expect(prompt).toContain(JSON.stringify(selected.quote));
    expect(prompt).toContain('"chapterId":"chapter-1"');
    expect(prompt).toContain("作者批注：保留拒绝的态度");
    expect(prompt).not.toContain(selected.projectPath);
    expect(prompt).toContain("核对当前原文");
  });

  it("deduplicates a repeated selection while keeping identical prose at distinct positions", () => {
    const store = useAgentSelectionStore.getState();
    store.addReference(selected);
    store.addReference(selected);
    store.addReference({ ...selected, start: 40, end: 48 });
    expect(useAgentSelectionStore.getState().references).toHaveLength(2);
  });

  it("limits references per source chapter without blocking a different chapter", () => {
    const store = useAgentSelectionStore.getState();
    for (let index = 0; index < 8; index++) store.addReference({ ...selected, start: index, end: index + 1 });
    expect(() => store.addReference({ ...selected, start: 100, end: 101 })).toThrow("最多添加 8 条");
    store.addReference({ ...selected, chapterId: "chapter-2" });
    expect(useAgentSelectionStore.getState().references.filter((item) => item.chapterId === "chapter-2")).toHaveLength(
      1
    );
  });

  it("restores a failed submission without removing newly attached quotes or duplicating restored ones", () => {
    const store = useAgentSelectionStore.getState();
    store.addReference(selected);
    const submitted = useAgentSelectionStore.getState().references;
    store.removeReferences(submitted.map((item) => item.id));
    store.addReference({ ...selected, start: 40, end: 48 });
    store.restoreReferences(submitted);
    store.restoreReferences(submitted);
    expect(useAgentSelectionStore.getState().references).toHaveLength(2);
  });

  it("keeps annotations separate from original prose and leaves unrelated messages intact", () => {
    const store = useAgentSelectionStore.getState();
    store.addReference(selected);
    const id = useAgentSelectionStore.getState().references[0].id;
    store.updateComment(id, "改成更克制的语气");
    expect(useAgentSelectionStore.getState().references[0].quote).toBe(selected.quote);
    expect(composeAgentSelectionPrompt("原来的要求", [])).toBe("原来的要求");
    expect(composeAgentSelectionPrompt("", useAgentSelectionStore.getState().references)).toContain("改成更克制的语气");
    store.removeReferences([id]);
    expect(useAgentSelectionStore.getState().references).toHaveLength(0);
  });
});
