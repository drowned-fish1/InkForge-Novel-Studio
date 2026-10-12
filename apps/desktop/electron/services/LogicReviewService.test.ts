import { describe, expect, it, vi } from "vitest";
import {
  ChapterContractSchema,
  EvidencePackSchema,
  ProjectDataSchema,
  applyProjectDataUpdate,
  selectProjectData
} from "@inkforge/schemas";
import { LogicReviewService } from "./LogicReviewService.js";
import { ProjectDataExtractionService } from "./ProjectDataExtractionService.js";

const pack = EvidencePackSchema.parse({
  chapterContract: ChapterContractSchema.parse({ chapterId: "ch-1" }),
  generatedAt: "2026-10-10T00:00:00Z"
});
const completion = (value: unknown) => ({
  message: { role: "assistant" as const, content: JSON.stringify(value) },
  model: "reviewer",
  usage: { total_tokens: 10 }
});
describe("logic editing and independent verification", () => {
  it.each([false, true])(
    "requires explicit compression permission for a long draft (compression=%s)",
    async (allowCompression) => {
      const provider = {
        runAgentCompletion: vi
          .fn()
          .mockResolvedValueOnce(
            completion({ revisedText: "文".repeat(400), findings: [], changes: [], unresolvedIssues: [] })
          )
          .mockResolvedValueOnce(completion({ passed: true, findings: [], unresolvedIssues: [] }))
      };
      const result = new LogicReviewService(provider).review({
        draft: "文".repeat(4000),
        recentText: "",
        instruction: "",
        evidencePack: pack,
        allowCompression
      });
      if (allowCompression) expect((await result).canApply).toBe(true);
      else {
        await expect(result).rejects.toThrow("严重缺失");
        expect(provider.runAgentCompletion).toHaveBeenCalledTimes(1);
      }
    }
  );
  it("allows evidence-based balance correction and verifies without editor opinions", async () => {
    const edit = {
      revisedText: "花去七枚元石，他的钱袋里还剩五枚。",
      findings: [{ severity: "hard", detail: "余额错误", evidence: "原有十二枚" }],
      changes: [{ before: "十五枚", after: "五枚", reason: "12-7=5" }],
      unresolvedIssues: []
    };
    const provider = {
      runAgentCompletion: vi
        .fn()
        .mockResolvedValueOnce(completion(edit))
        .mockResolvedValueOnce(completion({ passed: true, findings: [], unresolvedIssues: [] }))
    };
    const result = await new LogicReviewService(provider).review({
      draft: "花去七枚元石，他的钱袋里还剩十五枚。",
      recentText: "原有十二枚元石。",
      instruction: "完成交易",
      evidencePack: pack
    });
    expect(result.canApply).toBe(true);
    expect(result.originalDraft).toContain("十五枚");
    expect(result.revisedText).toContain("五枚");
    const verify = provider.runAgentCompletion.mock.calls[1][0];
    expect(verify.messages[1].content).toContain("原有十二枚");
    expect(verify.messages[1].content).not.toContain("12-7=5");
    expect(verify.providerRole).toBe("reviewer");
  });
  it("blocks unresolved verification and rejects malformed editing rather than falling back", async () => {
    const edit = { revisedText: "他施展了尚未学会的技能。", findings: [], changes: [], unresolvedIssues: [] };
    const provider = {
      runAgentCompletion: vi
        .fn()
        .mockResolvedValueOnce(completion(edit))
        .mockResolvedValueOnce(
          completion({
            passed: false,
            findings: [{ severity: "hard", detail: "技能未获得", evidence: "前文" }],
            unresolvedIssues: []
          })
        )
    };
    const result = await new LogicReviewService(provider).review({
      draft: edit.revisedText,
      recentText: "",
      instruction: "",
      evidencePack: pack
    });
    expect(result.canApply).toBe(false);
    provider.runAgentCompletion.mockResolvedValue(completion({ revisedText: "" }));
    await expect(
      new LogicReviewService(provider).review({
        draft: edit.revisedText,
        recentText: "",
        instruction: "",
        evidencePack: pack
      })
    ).rejects.toThrow();
  });
});
describe("accepted prose data extraction", () => {
  it("binds exact quotes and hashes to the accepted source and rejects invented evidence", async () => {
    const provider = {
      runAgentCompletion: vi.fn().mockResolvedValue(
        completion({
          changes: [{ operation: "set", key: "陆砚的钱袋", content: { 元石: 5 }, evidenceQuote: "还剩五枚元石" }]
        })
      )
    };
    const service = new ProjectDataExtractionService(provider);
    const result = await service.propose(
      "ch-1",
      "陆砚的钱袋里还剩五枚元石。",
      ProjectDataSchema.parse({
        revision: 3,
        entries: [{ key: "陆砚的钱袋", content: { 元石: 12, 兑换规则: "只能支付元石" } }]
      })
    );
    expect(result?.update).toMatchObject({
      expectedRevision: 3,
      effectiveChapterId: "ch-1",
      changes: [{ sourceChapterId: "ch-1", sources: [{ excerpt: "还剩五枚元石", startOffset: 6, endOffset: 12 }] }]
    });
    expect(result?.update.changes[0]).toMatchObject({ content: { 元石: 5, 兑换规则: "只能支付元石" } });
    await expect(service.propose("ch-1", "没有提到钱袋。", ProjectDataSchema.parse({}))).rejects.toThrow("正文依据");
  });
  it("reconstructs earlier balances and deleted records at a chapter boundary", () => {
    let document = ProjectDataSchema.parse({});
    document = applyProjectDataUpdate(document, {
      expectedRevision: 0,
      effectiveChapterId: "ch-1",
      changes: [{ operation: "set", key: "钱袋", content: { 元石: 12 } }]
    });
    document = applyProjectDataUpdate(document, {
      expectedRevision: 1,
      effectiveChapterId: "ch-2",
      changes: [{ operation: "set", key: "钱袋", content: { 元石: 5 } }]
    });
    document = applyProjectDataUpdate(document, {
      expectedRevision: 2,
      effectiveChapterId: "ch-3",
      changes: [{ operation: "delete", key: "钱袋" }]
    });
    expect(selectProjectData(document, "钱袋", 1000, ["ch-1", "ch-2", "ch-3"], "ch-1").entries[0]?.content).toEqual({
      元石: 12
    });
    expect(selectProjectData(document, "钱袋", 1000, ["ch-1", "ch-2", "ch-3"], "ch-2").entries[0]?.content).toEqual({
      元石: 5
    });
    expect(selectProjectData(document, "钱袋", 1000, ["ch-1", "ch-2", "ch-3"], "ch-3").entries).toEqual([]);
  });
});
