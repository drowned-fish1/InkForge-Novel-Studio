import { describe, expect, it } from "vitest";
import { analyzeProseStyle, compareProseStyle, mergeProseStyleMetrics } from "../src/style.js";

describe("prose style metrics", () => {
  it("measures Chinese prose and dialogue deterministically", () => {
    const metrics = analyzeProseStyle("雨停了。\n\n“你来了？”林昭问。\n\n他没有回答，只把伞放在门边。 ");
    expect(metrics.characterCount).toBeGreaterThan(20);
    expect(metrics.sentenceCount).toBe(4);
    expect(metrics.paragraphCount).toBe(3);
    expect(metrics.dialogueCharacters).toBe(4);
    expect(metrics.dialogueRatio).toBeGreaterThan(0);
    expect(metrics.punctuation["。"]).toBeGreaterThan(0);
  });

  it("returns a high score for matching samples", () => {
    const sample = "他推开门。风从走廊尽头吹来。\n\n“走吧。”她说。";
    const metrics = analyzeProseStyle(sample);
    const report = compareProseStyle(metrics, analyzeProseStyle(sample));
    expect(report.score).toBe(100);
    expect(report.warnings).toEqual([]);
  });

  it("flags obvious dialogue and sentence-length drift", () => {
    const baseline = analyzeProseStyle("他停下。她回头。雨还在下。灯灭了。门开了。");
    const actual = analyzeProseStyle(
      "“你到底想说什么，为什么一直不肯告诉我，又为什么偏偏要选在今天？”她连续问了很久很久，直到所有人都转过头来。"
    );
    const report = compareProseStyle(baseline, actual, 0.2);
    expect(report.score).toBeLessThan(80);
    expect(report.warnings.some((warning) => warning.includes("平均句长"))).toBe(true);
  });

  it("merges chapter metrics without holding the manuscript", () => {
    const first = analyzeProseStyle("雨停了。\n\n他走出门。");
    const second = analyzeProseStyle("“等等！”她追了上来。\n\n巷子里没有别人。");
    const merged = mergeProseStyleMetrics([first, second]);
    expect(merged.characterCount).toBe(first.characterCount + second.characterCount);
    expect(merged.sentenceCount).toBe(first.sentenceCount + second.sentenceCount);
    expect(merged.paragraphCount).toBe(first.paragraphCount + second.paragraphCount);
    expect(merged.dialogueCharacters).toBe(second.dialogueCharacters);
  });
});
