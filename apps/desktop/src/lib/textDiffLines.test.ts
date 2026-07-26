import { describe, expect, it } from "vitest";
import { diffTextLines, summarizeDiff } from "./textDiffLines";

describe("diffTextLines", () => {
  it("marks unchanged lines as context", () => {
    expect(diffTextLines("一\n二", "一\n二")).toEqual([
      { kind: "context", text: "一" },
      { kind: "context", text: "二" }
    ]);
  });

  it("detects replaced lines as remove + add", () => {
    const lines = diffTextLines("开头\n旧句子\n结尾", "开头\n新句子\n结尾");
    expect(lines).toEqual([
      { kind: "context", text: "开头" },
      expect.objectContaining({ kind: expect.stringMatching(/add|remove/) }),
      expect.objectContaining({ kind: expect.stringMatching(/add|remove/) }),
      { kind: "context", text: "结尾" }
    ]);
    expect(summarizeDiff(lines)).toEqual({ added: 1, removed: 1 });
  });

  it("handles pure insertion and deletion", () => {
    expect(summarizeDiff(diffTextLines("一\n二", "一\n插入\n二"))).toEqual({ added: 1, removed: 0 });
    expect(summarizeDiff(diffTextLines("一\n多余\n二", "一\n二"))).toEqual({ added: 0, removed: 1 });
  });

  it("falls back to trimmed replace-diff for very large inputs without hanging", () => {
    const left = Array.from({ length: 3000 }, (_, i) => `行${i}`).join("\n");
    const right = `${left}\n新增结尾`;
    const bigLeft = `${left}\n${left}`;
    const bigRight = `${right}\n${right}`;
    const lines = diffTextLines(bigLeft, bigRight);
    const summary = summarizeDiff(lines);
    expect(summary.added).toBeGreaterThan(0);
    expect(lines.length).toBeGreaterThan(0);
  });
});
