import { ChapterContractSchema, StoryThreadSchema, type CanonFact } from "@inkforge/schemas";
import { describe, expect, it } from "vitest";
import { ContinuationValidator } from "./ContinuationValidator.js";

describe("ContinuationValidator", () => {
  const contract = ChapterContractSchema.parse({
    chapterId: "ch-2",
    mustHappen: ["交出钥匙"],
    mustNotHappen: ["主角死亡"],
    threadsToPayoff: ["thread-1"],
    targetWords: 100
  });

  it("blocks missing hard requirements and forbidden beats", () => {
    const report = new ContinuationValidator().validate({ draft: "主角死亡。", contract });
    expect(report.canApply).toBe(false);
    expect(report.hardFailures).toBe(2);
  });

  it("enforces author-locked phrase constraints", () => {
    const fact: CanonFact = {
      id: "fact-1",
      subjectId: "book",
      predicate: "forbidden_phrase",
      objectValue: "量子手机",
      certainty: 1,
      status: "author_locked",
      evidence: [{ chapterId: "ch-1", startOffset: 0, endOffset: 2, excerpt: "禁用", contentHash: "hash" }],
      supersedes: [],
      source: "author",
      notes: ""
    };
    const report = new ContinuationValidator().validate({
      draft: "他交出钥匙，又拿出量子手机。",
      contract: { ...contract, targetWords: undefined },
      hardConstraints: [fact]
    });
    expect(report.canApply).toBe(false);
    expect(report.findings.some((finding) => finding.category === "canon")).toBe(true);
  });

  it("treats unlocked thread payoff misses and style drift as soft warnings", () => {
    const thread = StoryThreadSchema.parse({
      id: "thread-1",
      title: "旧钥匙",
      status: "due",
      expectedPayoff: "钥匙打开地下室",
      locked: false
    });
    const report = new ContinuationValidator().validate({
      draft: "他交出钥匙，随后离开。",
      contract: { ...contract, targetWords: undefined },
      dueThreads: [thread],
      styleEvaluation: { score: 70, warnings: ["平均句长偏离"], deltas: [] }
    });
    expect(report.canApply).toBe(true);
    expect(report.softWarnings).toBe(2);
    expect(report.styleScore).toBe(70);
  });
});
