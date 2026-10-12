import { describe, expect, it, vi } from "vitest";
import { ChapterContractSchema, EvidencePackSchema } from "@inkforge/schemas";
import { compareWriter } from "./compare-writer.mjs";
import { buildWriterMessages } from "@inkforge/prompt-engine";

describe("fixed-input writer comparison", () => {
  it("reuses a writer draft for raw/edited comparison and separates production from judge cost", async () => {
    const request = {
      schemaVersion: "inkforge.writer.v1" as const,
      task: "continue_scene" as const,
      storyPosition: { chapterId: "ch-1", sceneId: "scene-1", sourceCutoff: "ch-1:0" },
      chapterContract: ChapterContractSchema.parse({ chapterId: "ch-1" }),
      sceneContract: { goal: "开门", pov: "", styleConstraints: [] },
      evidencePack: EvidencePackSchema.parse({
        chapterContract: ChapterContractSchema.parse({ chapterId: "ch-1" }),
        generatedAt: "2026-10-10T00:00:00Z"
      }),
      recentText: "前文",
      authorInstruction: "开门",
      outputConstraints: { proseOnly: true as const, preserveNames: true as const }
    };
    const call = (text: string) => ({
      message: { role: "assistant", content: text },
      model: "mock",
      usage: { total_tokens: 10 },
      telemetry: { durationMs: 20, estimatedCost: 0.1 }
    });
    const complete = vi
      .fn()
      .mockResolvedValueOnce(call("原段落。\n\n错误段落。"))
      .mockResolvedValueOnce(call("通用正文。"))
      .mockResolvedValue(
        call(
          JSON.stringify({
            hardContradictions: [],
            goalCompletion: "通过",
            repetition: "无",
            foreignNames: "无",
            styleDrift: "待作者确认"
          })
        )
      );
    const review = vi.fn(async () => ({ revisedText: "原段落。\n\n修订段落。", calls: [call("编辑"), call("复核")] }));
    const report = await compareWriter({ request, complete, review });
    expect(review.mock.calls[0][0].draft).toBe("原段落。\n\n错误段落。");
    expect(complete.mock.calls[0][0].messages).toEqual(buildWriterMessages(request));
    expect(complete.mock.calls[1][0].messages).toEqual(buildWriterMessages(request));
    expect(report.variants.map((variant: { reportedTokens: number }) => variant.reportedTokens)).toEqual([10, 30, 10]);
    expect(report.variants[1].originalParagraphRetention).toBe(0.5);
    expect(report.variants[1].estimatedCost).toBeCloseTo(0.3);
    expect(report.authorAcceptance).toBeNull();
  });
});
