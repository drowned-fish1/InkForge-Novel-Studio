import { ChapterContractSchema, type CanonFact, type StoryThread } from "@inkforge/schemas";
import { describe, expect, it, vi } from "vitest";
import { ContextCompiler, renderEvidencePack } from "./ContextCompiler.js";

const evidence = { chapterId: "ch-1", startOffset: 0, endOffset: 4, excerpt: "旧门打开", contentHash: "hash" };
const lockedFact: CanonFact = {
  id: "fact-locked",
  subjectId: "lin",
  predicate: "required_term",
  objectValue: "玄门",
  certainty: 1,
  status: "author_locked",
  evidence: [evidence],
  supersedes: [],
  source: "author",
  notes: ""
};
const dueThread: StoryThread = {
  id: "thread-1",
  type: "mystery",
  title: "旧门",
  status: "due",
  setupRefs: [evidence],
  progressRefs: [],
  payoffRefs: [],
  expectedPayoff: "打开旧门",
  dependencies: [],
  relatedEntityIds: ["lin"],
  confidence: 1,
  locked: true,
  notes: ""
};

describe("ContextCompiler", () => {
  it("always includes locked facts and immediate continuity", async () => {
    const contract = ChapterContractSchema.parse({ chapterId: "ch-2", requiredEntityIds: ["lin"] });
    const compiler = new ContextCompiler(
      {
        assertInsideProject: vi.fn((_project, file) => file),
        readText: vi.fn(async () => "上一章正文。旧门还没有打开。")
      } as never,
      {
        openProject: vi.fn(async () => ({
          meta: { title: "书" },
          outline: {
            volumes: [
              {
                chapters: [
                  { id: "ch-1", number: 1, title: "一", file: "1.md" },
                  { id: "ch-2", number: 2, title: "二", goal: "开门", file: "2.md" }
                ]
              }
            ]
          }
        }))
      } as never,
      {
        listFactsAtChapter: vi.fn(async () => [lockedFact]),
        listStateAtChapter: vi.fn(async () => []),
        getStyleProfile: vi.fn(async () => undefined)
      } as never,
      {
        listDueThreads: vi.fn(async () => [dueThread]),
        listThreads: vi.fn(async () => [dueThread])
      } as never,
      {
        retrieve: vi.fn(async () => ({ hits: [], mode: "lexical", retrievalMode: "lexical" }))
      } as never
    );
    const pack = await compiler.compile({ projectPath: "project", chapterId: "ch-2", contract, tokenBudget: 800 });
    expect(pack.hardConstraints.map((fact) => fact.id)).toEqual(["fact-locked"]);
    expect(pack.immediateContinuity[0]?.chapterId).toBe("ch-1");
    expect(pack.dueThreads[0]?.id).toBe("thread-1");
    expect(renderEvidencePack(pack)).toContain("不可违反的正典");
  });

  it("deduplicates retrieved evidence and reports budget omissions", async () => {
    const contract = ChapterContractSchema.parse({ chapterId: "ch-1" });
    const longEvidence = { ...evidence, excerpt: "证据".repeat(2_000) };
    const compiler = new ContextCompiler(
      { assertInsideProject: vi.fn(), readText: vi.fn() } as never,
      {
        openProject: vi.fn(async () => ({
          meta: { title: "书" },
          outline: { volumes: [{ chapters: [{ id: "ch-1", number: 1, title: "一", goal: "", file: "1.md" }] }] }
        }))
      } as never,
      {
        listFactsAtChapter: vi.fn(async () => []),
        listStateAtChapter: vi.fn(async () => []),
        getStyleProfile: vi.fn(async () => undefined)
      } as never,
      { listDueThreads: vi.fn(async () => []), listThreads: vi.fn(async () => []) } as never,
      {
        retrieve: vi.fn(async () => ({
          hits: [{ evidence: longEvidence }, { evidence: longEvidence }],
          mode: "lexical",
          retrievalMode: "lexical"
        }))
      } as never
    );
    const pack = await compiler.compile({ projectPath: "project", chapterId: "ch-1", contract, tokenBudget: 800 });
    expect(pack.retrievedEvidence).toEqual([]);
    expect(pack.omittedSections).toContain("retrievedEvidence");
  });
});
