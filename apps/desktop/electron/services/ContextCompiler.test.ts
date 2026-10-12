import { ChapterContractSchema, ProjectDataSchema, type CanonFact, type StoryThread } from "@inkforge/schemas";
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
  it("blocks an author-locked fact whose original quote was rewritten", async () => {
    const compiler = new ContextCompiler(
      { assertInsideProject: () => "1.md", readText: async () => "旧门紧闭" } as never,
      {
        openProject: async () => ({
          outline: { volumes: [{ chapters: [{ id: "ch-1", number: 1, title: "一", file: "1.md" }] }] }
        })
      } as never,
      {
        listFactsAtChapter: async () => [lockedFact],
        listStateAtChapter: async () => [],
        getStyleProfile: async () => undefined
      } as never,
      { listDueThreads: async () => [] } as never,
      { retrieve: async () => ({ hits: [] }) } as never,
      { load: async () => ProjectDataSchema.parse({}) } as never
    );
    await expect(
      compiler.compile({
        projectPath: "project",
        chapterId: "ch-1",
        contract: ChapterContractSchema.parse({ chapterId: "ch-1" })
      })
    ).rejects.toThrow("锁定事实来源已失效");
  });
  it("excludes later chapters and later offsets in current evidence, style and facts", async () => {
    const before = { ...evidence, chapterId: "ch-2", excerpt: "已有", startOffset: 0, endOffset: 2 };
    const later = { ...before, excerpt: "后续", startOffset: 2, endOffset: 4 };
    const future = { ...before, chapterId: "ch-3", excerpt: "结局" };
    const retrieve = vi.fn(async () => ({ hits: [before, later, future].map((ref) => ({ evidence: ref })) }));
    const compiler = new ContextCompiler(
      { assertInsideProject: (_project: string, file: string) => file, readText: async () => "已有后续" } as never,
      {
        openProject: async () => ({
          outline: {
            volumes: [
              {
                chapters: [1, 2, 3].map((number) => ({
                  id: `ch-${number}`,
                  number,
                  title: String(number),
                  file: `${number}.md`
                }))
              }
            ]
          }
        })
      } as never,
      {
        listFactsAtChapter: async () => [{ ...lockedFact, evidence: [later] }],
        listStateAtChapter: async () => [],
        getStyleProfile: async () => ({ sceneExemplars: { action: [later, future] } })
      } as never,
      { listDueThreads: async () => [], listThreads: async () => [] } as never,
      { retrieve } as never,
      { load: async () => ProjectDataSchema.parse({}) } as never
    );
    const pack = await compiler.compile({
      projectPath: "project",
      chapterId: "ch-2",
      contract: ChapterContractSchema.parse({ chapterId: "ch-2" }),
      sourceCutoff: 2
    });
    expect(pack.hardConstraints).toEqual([]);
    expect(pack.styleExemplars).toEqual([]);
    expect(pack.immediateContinuity.find((ref) => ref.chapterId === "ch-2")?.excerpt).toBe("已有");
    expect(
      pack.retrievedEvidence.some((ref) => ref.chapterId === "ch-3" || (ref.chapterId === "ch-2" && ref.endOffset > 2))
    ).toBe(false);
    expect(retrieve).toHaveBeenCalledWith(
      "project",
      expect.any(String),
      expect.objectContaining({ chapterIds: ["ch-1", "ch-2"] })
    );
  });
  it("always includes locked facts and immediate continuity", async () => {
    const contract = ChapterContractSchema.parse({ chapterId: "ch-2", requiredEntityIds: ["lin"] });
    const compiler = new ContextCompiler(
      {
        assertInsideProject: vi.fn((_project, file) => file),
        readText: vi.fn(async () => "旧门打开。上一章正文。")
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
      } as never,
      {
        load: vi.fn(async () =>
          ProjectDataSchema.parse({
            entries: [
              { key: "玄门门规", content: { 禁止: "夜间鸣钟" }, sourceChapterId: "ch-1" },
              { key: "结局", content: "尚未发生", sourceChapterId: "future" }
            ]
          })
        )
      } as never
    );
    const pack = await compiler.compile({ projectPath: "project", chapterId: "ch-2", contract, tokenBudget: 800 });
    expect(pack.hardConstraints.map((fact) => fact.id)).toEqual(["fact-locked"]);
    expect(pack.immediateContinuity[0]?.chapterId).toBe("ch-2");
    expect(pack.dueThreads[0]?.id).toBe("thread-1");
    expect(renderEvidencePack(pack)).toContain("不可违反的正典");
    expect(pack.projectData.map((entry) => entry.key)).toEqual(["玄门门规"]);
    expect(renderEvidencePack(pack)).toContain("夜间鸣钟");
    expect(pack.omittedSections).toContain("projectData");
  });

  it("deduplicates retrieved evidence and reports budget omissions", async () => {
    const contract = ChapterContractSchema.parse({ chapterId: "ch-1" });
    const longEvidence = { ...evidence, startOffset: 0, endOffset: 4_000, excerpt: "证据".repeat(2_000) };
    const compiler = new ContextCompiler(
      { assertInsideProject: vi.fn(), readText: vi.fn(async () => longEvidence.excerpt) } as never,
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
