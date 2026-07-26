import { rm } from "node:fs/promises";
import path from "node:path";
import { ChapterMemorySchema, type AgentChangeProposal, type ChapterMemory, type ChapterPlan } from "@inkforge/schemas";
import { FileRepository } from "./FileRepository.js";

interface ProjectMemoryDigest {
  version: 1;
  chapterIds: string[];
  summary: string;
  unresolvedThreads: string[];
  keywords: string[];
  updatedAt: string;
}

interface ChapterMemorySnapshot {
  version: 1;
  id: string;
  chapterId: string;
  existed: boolean;
  memory?: ChapterMemory;
  createdAt: string;
}

export interface ChapterMemoryContext {
  content: string;
  estimatedTokens: number;
  recentMemories: number;
  compressedMemories: number;
}

export class ChapterMemoryService {
  constructor(private readonly files = new FileRepository()) {}

  async load(projectPath: string, chapterId: string): Promise<ChapterMemory | undefined> {
    try {
      return ChapterMemorySchema.parse(await this.files.readJson(this.memoryPath(projectPath, chapterId)));
    } catch (error) {
      if (isMissingFile(error)) {
        return undefined;
      }
      throw error;
    }
  }

  async save(projectPath: string, memory: ChapterMemory): Promise<ChapterMemory> {
    const parsed = ChapterMemorySchema.parse(memory);
    await this.files.writeJsonAtomic(this.memoryPath(projectPath, parsed.chapterId), parsed);
    return parsed;
  }

  async delete(projectPath: string, chapterId: string): Promise<void> {
    await rm(this.memoryPath(projectPath, chapterId), { force: true });
    await rm(this.digestPath(projectPath), { force: true });
  }

  async createSnapshot(projectPath: string, chapterId: string, snapshotId: string): Promise<string> {
    const memory = await this.load(projectPath, chapterId);
    const snapshot: ChapterMemorySnapshot = {
      version: 1,
      id: snapshotId,
      chapterId,
      existed: Boolean(memory),
      memory,
      createdAt: new Date().toISOString()
    };
    await this.files.writeJsonAtomic(this.memorySnapshotPath(projectPath, snapshotId), snapshot);
    return snapshotId;
  }

  async restoreSnapshot(projectPath: string, snapshotId: string): Promise<void> {
    const snapshot = (await this.files.readJson(
      this.memorySnapshotPath(projectPath, snapshotId)
    )) as ChapterMemorySnapshot;
    if (snapshot.version !== 1 || snapshot.id !== snapshotId || !snapshot.chapterId) {
      throw new Error("章节记忆快照无效。");
    }
    if (snapshot.existed && snapshot.memory) {
      await this.save(projectPath, snapshot.memory);
    } else {
      await this.delete(projectPath, snapshot.chapterId);
    }
  }

  async recordChapterChange(
    projectPath: string,
    chapter: ChapterPlan,
    proposal: AgentChangeProposal,
    summary: string
  ): Promise<ChapterMemory> {
    const existing = await this.load(projectPath, chapter.id);
    const changeNotes = proposal.blocks.length
      ? proposal.blocks
          .filter((block) => block.status === "accepted")
          .map((block) => block.explanation)
          .filter(Boolean)
      : [proposal.explanation].filter(Boolean);
    const memory: ChapterMemory = {
      schemaVersion: "0.1.0",
      chapterId: chapter.id,
      summary: summary.trim() || existing?.summary || proposal.explanation,
      characterStates: existing?.characterStates ?? [],
      unresolvedThreads: unique([...(existing?.unresolvedThreads ?? []), chapter.hook].filter(Boolean)),
      clueUpdates: unique([...(existing?.clueUpdates ?? []), ...changeNotes]),
      worldStateChanges: existing?.worldStateChanges ?? [],
      keywords: unique([
        ...(existing?.keywords ?? []),
        ...chapter.characters,
        ...chapter.worldRefs,
        ...extractKeywords(`${chapter.goal} ${chapter.hook} ${proposal.explanation}`)
      ]).slice(0, 30),
      updatedAt: new Date().toISOString()
    };
    return this.save(projectPath, memory);
  }

  async buildContext(
    projectPath: string,
    chapters: ChapterPlan[],
    currentIndex: number,
    tokenBudget = 700,
    recentCount = 4
  ): Promise<ChapterMemoryContext> {
    const upperBound = currentIndex >= 0 ? currentIndex + 1 : chapters.length;
    const relevantChapters = chapters.slice(0, upperBound);
    const recentChapters = relevantChapters.slice(-recentCount);
    const olderChapters = relevantChapters.slice(0, Math.max(0, relevantChapters.length - recentChapters.length));
    const [recent, older] = await Promise.all([
      Promise.all(
        recentChapters.map(async (chapter) => ({ chapter, memory: await this.load(projectPath, chapter.id) }))
      ),
      Promise.all(olderChapters.map(async (chapter) => ({ chapter, memory: await this.load(projectPath, chapter.id) })))
    ]);
    const availableRecent = recent.filter((item): item is { chapter: ChapterPlan; memory: ChapterMemory } =>
      Boolean(item.memory)
    );
    const availableOlder = older.filter((item): item is { chapter: ChapterPlan; memory: ChapterMemory } =>
      Boolean(item.memory)
    );
    const digest = availableOlder.length ? await this.saveDigest(projectPath, availableOlder) : undefined;
    const sections = [
      ...availableRecent.map(
        ({ chapter, memory }) =>
          `- ${chapter.title}: ${memory.summary || "暂无摘要"}${
            memory.unresolvedThreads.length ? `；未决：${memory.unresolvedThreads.join("、")}` : ""
          }`
      ),
      digest?.summary ? `- 更早章节压缩记忆：${digest.summary}` : ""
    ].filter(Boolean);
    const content = fitToTokenBudget(sections.join("\n"), tokenBudget);
    return {
      content,
      estimatedTokens: estimateTokens(content),
      recentMemories: availableRecent.length,
      compressedMemories: availableOlder.length
    };
  }

  private memoryPath(projectPath: string, chapterId: string): string {
    return this.files.assertInsideProject(
      projectPath,
      path.posix.join(".inkforge", "agents", "memory", `${safeId(chapterId)}.json`)
    );
  }

  private memorySnapshotPath(projectPath: string, snapshotId: string): string {
    if (!/^[\w.-]+$/u.test(snapshotId)) {
      throw new Error("章节记忆快照 ID 无效。");
    }
    return this.files.assertInsideProject(
      projectPath,
      path.posix.join(".inkforge", "agents", "memory-history", `${snapshotId}.json`)
    );
  }

  private digestPath(projectPath: string): string {
    return this.files.assertInsideProject(
      projectPath,
      path.posix.join(".inkforge", "agents", "memory", "project-digest.json")
    );
  }

  private async saveDigest(
    projectPath: string,
    items: Array<{ chapter: ChapterPlan; memory: ChapterMemory }>
  ): Promise<ProjectMemoryDigest> {
    const digest: ProjectMemoryDigest = {
      version: 1,
      chapterIds: items.map(({ chapter }) => chapter.id),
      summary: items
        .map(({ chapter, memory }) => `${chapter.title}：${memory.summary.slice(0, 220)}`)
        .join("；")
        .slice(-5_000),
      unresolvedThreads: unique(items.flatMap(({ memory }) => memory.unresolvedThreads)).slice(0, 40),
      keywords: unique(items.flatMap(({ memory }) => memory.keywords)).slice(0, 80),
      updatedAt: new Date().toISOString()
    };
    await this.files.writeJsonAtomic(this.digestPath(projectPath), digest);
    return digest;
  }
}

const safeId = (value: string): string => value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "chapter";

const unique = (values: string[]): string[] => [...new Set(values.map((value) => value.trim()).filter(Boolean))];

const extractKeywords = (value: string): string[] =>
  value
    .split(/[\s，。！？、；：,.!?;:()[\]{}“”"'《》]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && item.length <= 16)
    .slice(0, 20);

const estimateTokens = (value: string): number => Math.ceil(value.length / 3);

const fitToTokenBudget = (value: string, tokenBudget: number): string => {
  const maxCharacters = Math.max(0, tokenBudget) * 3;
  if (value.length <= maxCharacters) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxCharacters - 1)).trimEnd()}…`;
};

const isMissingFile = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT";
