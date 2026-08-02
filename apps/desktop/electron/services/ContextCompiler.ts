import { createHash } from "node:crypto";
import {
  EvidencePackSchema,
  estimateTokensCjkAware,
  type CanonFact,
  type ChapterContract,
  type EvidencePack,
  type EvidenceRef,
  type StoryThread
} from "@inkforge/schemas";
import { CanonStore } from "./CanonStore.js";
import { FileRepository } from "./FileRepository.js";
import { HybridRetriever } from "./HybridRetriever.js";
import { ProjectService } from "./ProjectService.js";
import { StoryThreadService } from "./StoryThreadService.js";

export interface CompileContextInput {
  projectPath: string;
  chapterId: string;
  contract: ChapterContract;
  instruction?: string;
  tokenBudget?: number;
  retrievalLimit?: number;
}

export class ContextCompiler {
  constructor(
    private readonly files: FileRepository,
    private readonly projects: ProjectService,
    private readonly canon: CanonStore,
    private readonly threads: StoryThreadService,
    private readonly retriever: HybridRetriever
  ) {}

  async compile(input: CompileContextInput): Promise<EvidencePack> {
    const project = await this.projects.openProject(input.projectPath);
    const chapters = project.outline.volumes.flatMap((volume) => volume.chapters);
    const chapterIndex = chapters.findIndex((chapter) => chapter.id === input.chapterId);
    const chapter = chapters[chapterIndex];
    if (!chapter) throw new Error(`Chapter not found: ${input.chapterId}`);
    const order = chapters.map((item) => item.id);
    const query = buildQuery(input.contract, input.instruction, chapter.title, chapter.goal);
    const [facts, due, profile, retrieval] = await Promise.all([
      this.canon.listFactsAtChapter(input.projectPath, input.chapterId, order),
      this.threads.listDueThreads(input.projectPath, chapter.number),
      this.canon.getStyleProfile(input.projectPath),
      this.retriever.retrieve(input.projectPath, query, { limit: input.retrievalLimit ?? 20, mode: "hybrid" })
    ]);
    const requiredFactIds = new Set(input.contract.requiredFactIds);
    const requiredEntityIds = new Set(input.contract.requiredEntityIds);
    for (const factId of requiredFactIds) {
      const fact = facts.find((candidate) => candidate.id === factId);
      if (!fact) throw new Error(`章节契约引用了不存在或当前无效的正典事实：${factId}`);
      if (fact.status !== "confirmed" && fact.status !== "author_locked") {
        throw new Error(`章节契约引用的正典事实尚未确认或存在冲突：${factId}`);
      }
    }
    const hardConstraints = facts.filter(
      (fact) => fact.status === "author_locked" || (requiredFactIds.has(fact.id) && fact.status === "confirmed")
    );
    const stateTransitions = (
      await Promise.all(
        [...requiredEntityIds].map((entityId) =>
          this.canon.listStateAtChapter(input.projectPath, entityId, input.chapterId, order)
        )
      )
    ).flat();
    const transitionFacts: CanonFact[] = stateTransitions.map((transition) => ({
      id: `state-${transition.id}`,
      subjectId: transition.subjectId,
      predicate: transition.predicate,
      objectValue: transition.toValue,
      validFromChapterId: transition.chapterId,
      certainty: transition.certainty,
      status: "confirmed",
      evidence: transition.evidence,
      supersedes: [],
      source: "extraction",
      notes: transition.reason
    }));
    const activeCharacterStates = dedupeById([
      ...facts.filter(
        (fact) =>
          fact.status !== "candidate" &&
          fact.status !== "rejected" &&
          fact.status !== "conflicted" &&
          requiredEntityIds.has(fact.subjectId) &&
          !hardConstraints.some((hard) => hard.id === fact.id)
      ),
      ...transitionFacts
    ]);
    const requiredThreadIds = new Set([
      ...input.contract.requiredThreadIds,
      ...input.contract.dueThreadIds,
      ...input.contract.threadsToAdvance,
      ...input.contract.threadsToPayoff
    ]);
    const allThreads = requiredThreadIds.size ? await this.threads.listThreads(input.projectPath) : due;
    for (const threadId of requiredThreadIds) {
      const thread = allThreads.find((candidate) => candidate.id === threadId);
      if (!thread) throw new Error(`章节契约引用了不存在的剧情线：${threadId}`);
      if (thread.status === "resolved" || thread.status === "abandoned") {
        throw new Error(`章节契约引用的剧情线已经关闭：${threadId}`);
      }
    }
    const dueThreads = dedupeById([
      ...due,
      ...allThreads.filter(
        (thread) => requiredThreadIds.has(thread.id) && thread.status !== "resolved" && thread.status !== "abandoned"
      )
    ]);
    const immediateContinuity = await this.immediateContinuity(input.projectPath, chapters, chapterIndex);
    const styleExemplars = profile ? dedupeEvidence(Object.values(profile.sceneExemplars).flat()).slice(0, 8) : [];
    const retrievalCandidates = dedupeEvidence(retrieval.hits.map((hit) => hit.evidence)).filter(
      (ref) =>
        !immediateContinuity.some((item) => evidenceKey(item) === evidenceKey(ref)) &&
        !styleExemplars.some((item) => evidenceKey(item) === evidenceKey(ref))
    );
    const tokenBudget = Math.max(800, Math.min(16_000, input.tokenBudget ?? 6_000));
    const hardTokens = estimateTokensCjkAware(renderFacts(hardConstraints));
    const contractTokens = estimateTokensCjkAware(JSON.stringify(input.contract));
    let remaining = Math.max(0, tokenBudget - hardTokens - contractTokens);
    const tokenUsageBySection: Record<string, number> = {
      chapterContract: contractTokens,
      hardConstraints: hardTokens
    };
    const omittedSections: string[] = [];

    const fitEvidence = (name: string, refs: EvidenceRef[], allowance: number): EvidenceRef[] => {
      const kept: EvidenceRef[] = [];
      let used = 0;
      for (const ref of refs) {
        const tokens = estimateTokensCjkAware(ref.excerpt);
        if (used + tokens > Math.min(allowance, remaining)) continue;
        kept.push(ref);
        used += tokens;
      }
      tokenUsageBySection[name] = used;
      remaining -= used;
      if (kept.length < refs.length) omittedSections.push(name);
      return kept;
    };
    const fittedImmediate = fitEvidence("immediateContinuity", immediateContinuity, 1_500);
    const stateTokens = estimateTokensCjkAware(renderFacts(activeCharacterStates));
    let fittedStates = activeCharacterStates;
    if (stateTokens > remaining) {
      fittedStates = fitFacts(activeCharacterStates, remaining);
      omittedSections.push("activeCharacterStates");
    }
    tokenUsageBySection.activeCharacterStates = estimateTokensCjkAware(renderFacts(fittedStates));
    remaining = Math.max(0, remaining - tokenUsageBySection.activeCharacterStates);
    const threadTokens = estimateTokensCjkAware(renderThreads(dueThreads));
    let fittedThreads = dueThreads;
    if (threadTokens > remaining) {
      fittedThreads = fitThreads(dueThreads, remaining);
      omittedSections.push("dueThreads");
    }
    tokenUsageBySection.dueThreads = estimateTokensCjkAware(renderThreads(fittedThreads));
    remaining = Math.max(0, remaining - tokenUsageBySection.dueThreads);
    const fittedRetrieved = fitEvidence("retrievedEvidence", retrievalCandidates, Math.max(0, remaining - 500));
    const fittedStyle = fitEvidence("styleExemplars", styleExemplars, remaining);
    return EvidencePackSchema.parse({
      hardConstraints,
      immediateContinuity: fittedImmediate,
      chapterContract: input.contract,
      activeCharacterStates: fittedStates,
      dueThreads: fittedThreads,
      retrievedEvidence: fittedRetrieved,
      styleExemplars: fittedStyle,
      exclusions: [],
      tokenUsageBySection,
      omittedSections: [...new Set(omittedSections)],
      generatedAt: new Date().toISOString(),
      query
    });
  }

  private async immediateContinuity(
    projectPath: string,
    chapters: Array<{ id: string; file: string }>,
    currentIndex: number
  ): Promise<EvidenceRef[]> {
    const previous = chapters[currentIndex - 1];
    if (!previous) return [];
    const content = await this.files
      .readText(this.files.assertInsideProject(projectPath, previous.file))
      .catch(() => "");
    if (!content.trim()) return [];
    const excerpt = content.slice(-1_800).trim();
    const startOffset = Math.max(0, content.lastIndexOf(excerpt));
    return [
      {
        chapterId: previous.id,
        startOffset,
        endOffset: startOffset + excerpt.length,
        excerpt,
        contentHash: createHash("sha256").update(content).digest("hex")
      }
    ];
  }
}

export const renderEvidencePack = (pack: EvidencePack): string =>
  [
    "## 章节契约",
    JSON.stringify(pack.chapterContract, null, 2),
    pack.hardConstraints.length ? `## 不可违反的正典\n${renderFacts(pack.hardConstraints)}` : "",
    pack.activeCharacterStates.length ? `## 当前人物/实体状态\n${renderFacts(pack.activeCharacterStates)}` : "",
    pack.dueThreads.length ? `## 本章相关剧情线\n${renderThreads(pack.dueThreads)}` : "",
    renderEvidenceSection("即时连续性", pack.immediateContinuity),
    renderEvidenceSection("检索到的原文证据", pack.retrievedEvidence),
    renderEvidenceSection("文风范例", pack.styleExemplars),
    pack.exclusions.length ? `## 禁写项\n${pack.exclusions.map((item) => `- ${item}`).join("\n")}` : ""
  ]
    .filter(Boolean)
    .join("\n\n");

const buildQuery = (contract: ChapterContract, instruction: string | undefined, title: string, goal: string) =>
  [
    instruction,
    title,
    goal,
    contract.pov,
    ...contract.mustHappen,
    ...contract.requiredBeats,
    ...contract.requiredEntityIds,
    ...contract.threadsToAdvance,
    ...contract.threadsToPayoff
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 2_000);

const renderFacts = (facts: CanonFact[]): string =>
  facts
    .map((fact) => `- [${fact.status}] ${fact.subjectId}.${fact.predicate} = ${JSON.stringify(fact.objectValue)}`)
    .join("\n");
const renderThreads = (threads: StoryThread[]): string =>
  threads
    .map(
      (thread) =>
        `- [${thread.status}${thread.locked ? "/locked" : ""}] ${thread.title}：${thread.expectedPayoff || thread.notes}`
    )
    .join("\n");
const renderEvidenceSection = (title: string, refs: EvidenceRef[]): string =>
  refs.length
    ? `## ${title}\n${refs.map((ref) => `- [${ref.chapterId}:${ref.startOffset}-${ref.endOffset}] ${ref.excerpt}`).join("\n")}`
    : "";
const fitFacts = (facts: CanonFact[], budget: number): CanonFact[] =>
  fitItems(facts, budget, (items) => renderFacts(items));
const fitThreads = (threads: StoryThread[], budget: number): StoryThread[] =>
  fitItems(threads, budget, (items) => renderThreads(items));
const fitItems = <T>(items: T[], budget: number, render: (items: T[]) => string): T[] => {
  const kept: T[] = [];
  for (const item of items) {
    if (estimateTokensCjkAware(render([...kept, item])) > budget) break;
    kept.push(item);
  }
  return kept;
};
const evidenceKey = (ref: EvidenceRef) => `${ref.chapterId}:${ref.sceneId ?? ""}:${ref.startOffset}:${ref.endOffset}`;
const dedupeEvidence = (refs: EvidenceRef[]) => [...new Map(refs.map((ref) => [evidenceKey(ref), ref])).values()];
const dedupeById = <T extends { id: string }>(items: T[]) => [
  ...new Map(items.map((item) => [item.id, item])).values()
];
