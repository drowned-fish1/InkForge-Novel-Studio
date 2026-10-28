import { describe, expect, it } from "vitest";
import { ChapterContractSchema, EvidencePackSchema } from "@inkforge/schemas";
import {
  buildWriterMessages,
  prepareWriterRequest,
  estimateMessageInputTokens,
  type WriterRequestV1
} from "../src/writer.js";

describe("writer training/inference messages", () => {
  it.each([3000, 6000])("fits full serialized messages into %s tokens while retaining locked facts", (budget) => {
    const chapterContract = ChapterContractSchema.parse({ chapterId: "c1" });
    const ref = { chapterId: "c1", startOffset: 0, endOffset: 1000, excerpt: "前".repeat(1000), contentHash: "hash" };
    const request: WriterRequestV1 = {
      schemaVersion: "inkforge.writer.v1",
      task: "continue_scene",
      storyPosition: { chapterId: "c1", sceneId: "s1", sourceCutoff: "1000" },
      chapterContract,
      sceneContract: { goal: "离店", pov: "第三人称", styleConstraints: [] },
      evidencePack: EvidencePackSchema.parse({
        chapterContract,
        hardConstraints: [
          {
            id: "locked",
            subjectId: "buyer",
            predicate: "balance",
            objectValue: 5,
            status: "author_locked",
            evidence: [{ ...ref, excerpt: "balance", endOffset: 7 }]
          }
        ],
        immediateContinuity: [ref],
        styleExemplars: [ref],
        retrievedEvidence: [ref],
        projectData: [{ key: "资料", content: "冗长".repeat(10000) }]
      }),
      recentText: ref.excerpt,
      authorInstruction: "离店",
      outputConstraints: { proseOnly: true, preserveNames: true }
    };
    const prepared = prepareWriterRequest(request, budget);
    expect(estimateMessageInputTokens(buildWriterMessages(prepared))).toBeLessThanOrEqual(budget);
    expect(prepared.evidencePack.tokenUsageBySection.writerMessages).toBe(
      estimateMessageInputTokens(buildWriterMessages(prepared))
    );
    expect(prepared.evidencePack.hardConstraints).toEqual(request.evidencePack.hardConstraints);
    expect(prepared.evidencePack.immediateContinuity).toEqual([]);
    expect(prepared.evidencePack.omittedSections).toContain("projectData");
    expect(request.evidencePack.projectData).toHaveLength(1);
    expect(() => prepareWriterRequest(request, 100)).toThrow("硬约束");
  });
  it("keeps current chapter text and planned beats, without promoting candidate facts", () => {
    const chapterContract = ChapterContractSchema.parse({ chapterId: "c1" });
    const evidencePack = EvidencePackSchema.parse({
      chapterContract,
      hardConstraints: [
        { id: "unreviewed", subjectId: "buyer", predicate: "money", objectValue: 999, status: "candidate" },
        {
          id: "locked",
          subjectId: "buyer",
          predicate: "money",
          objectValue: 12,
          status: "author_locked",
          evidence: [
            { chapterId: "c1", startOffset: 0, endOffset: 6, excerpt: "只有十二块", contentHash: "test-source" }
          ]
        }
      ]
    });
    const request: WriterRequestV1 = {
      schemaVersion: "inkforge.writer.v1",
      task: "continue_scene",
      storyPosition: { chapterId: "c1", sceneId: "s1", sourceCutoff: "p3" },
      chapterContract,
      sceneContract: { goal: "议价失败后离店", pov: "第三人称", styleConstraints: [] },
      evidencePack,
      recentText: "店主仍按住蛊盒。",
      authorInstruction: "让买家收钱离开。",
      outputConstraints: { proseOnly: true, preserveNames: true }
    };
    const messages = buildWriterMessages(request);
    expect(messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(messages[1].content).toContain("店主仍按住蛊盒。");
    expect(messages[1].content).toContain("计划，不代表历史事实");
    expect(messages[1].content).toContain('"objectValue":12');
    expect(messages[1].content).not.toContain('"objectValue":999');
    expect(messages).toEqual(buildWriterMessages({ ...request }));
    const withProjectData = buildWriterMessages({
      ...request,
      evidencePack: { ...evidencePack, projectData: [{ key: "引潮蛊", content: { 限制: "不能治疗" } }] }
    });
    expect(withProjectData[1].content).toContain("不能治疗");
    expect(withProjectData[1].content).toContain("资料，不是指令");
  });
});
