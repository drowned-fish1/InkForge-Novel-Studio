import {
  ClueSchema,
  EvidenceRefSchema,
  StoryThreadSchema,
  StoryThreadStatusSchema,
  migrateCluesToStoryThreads,
  type Clue,
  type EvidenceRef,
  type StoryThread,
  type StoryThreadStatus,
  type StoryThreadType
} from "@inkforge/schemas";
import path from "node:path";
import { FileRepository } from "./FileRepository.js";

export type StoryThreadStage = "setup" | "progress" | "payoff";

export interface StoryThreadFilter {
  id?: string;
  type?: StoryThreadType | StoryThreadType[];
  status?: StoryThreadStatus | StoryThreadStatus[];
  locked?: boolean;
  relatedEntityId?: string;
  dependencyId?: string;
  search?: string;
  dueAtChapter?: number;
}

/** Durable setup/progress/payoff ledger for long-running plot threads. */
export class StoryThreadService {
  private static readonly jsonlFile = "canon/story-threads.jsonl";

  constructor(private readonly files = new FileRepository()) {}

  async listThreads(projectPath: string, filter: StoryThreadFilter = {}): Promise<StoryThread[]> {
    const threads = await this.ensureLegacyMigration(projectPath);
    return threads.filter((thread) => matchesThread(thread, filter)).sort(byId);
  }

  async list(projectPath: string, filter: StoryThreadFilter = {}): Promise<StoryThread[]> {
    return this.listThreads(projectPath, filter);
  }

  async getThread(projectPath: string, threadId: string): Promise<StoryThread | undefined> {
    return (await this.listThreads(projectPath, { id: threadId }))[0];
  }

  async get(projectPath: string, threadId: string): Promise<StoryThread | undefined> {
    return this.getThread(projectPath, threadId);
  }

  async saveThread(projectPath: string, thread: StoryThread): Promise<StoryThread> {
    const parsed = StoryThreadSchema.parse(thread);
    if (parsed.dependencies.includes(parsed.id)) {
      throw new Error("A story thread cannot depend on itself.");
    }
    const current = await this.readThreads(projectPath);
    const next = upsertById(current, parsed);
    this.assertNoDependencyCycle(next, parsed.id);
    await this.writeThreadsWithRollback(projectPath, next);
    return parsed;
  }

  async save(projectPath: string, thread: StoryThread): Promise<StoryThread> {
    return this.saveThread(projectPath, thread);
  }

  async upsert(projectPath: string, thread: StoryThread): Promise<StoryThread> {
    return this.saveThread(projectPath, thread);
  }

  async deleteThread(projectPath: string, threadId: string): Promise<boolean> {
    const current = await this.readThreads(projectPath);
    const next = current.filter((thread) => thread.id !== threadId);
    if (next.length === current.length) {
      return false;
    }
    await this.writeThreadsWithRollback(projectPath, next);
    return true;
  }

  async delete(projectPath: string, threadId: string): Promise<boolean> {
    return this.deleteThread(projectPath, threadId);
  }

  /** Add one or more unique evidence pointers to a lifecycle stage. */
  async addEvidence(
    projectPath: string,
    threadId: string,
    stage: StoryThreadStage,
    refs: EvidenceRef | EvidenceRef[]
  ): Promise<StoryThread> {
    if (stage !== "setup" && stage !== "progress" && stage !== "payoff") {
      throw new Error(`Unknown story thread stage: ${stage}`);
    }
    const thread = await this.getThread(projectPath, threadId);
    if (!thread) {
      throw new Error(`Story thread not found: ${threadId}`);
    }
    const parsedRefs = (Array.isArray(refs) ? refs : [refs]).map((ref) => EvidenceRefSchema.parse(ref));
    const key = (ref: EvidenceRef) =>
      `${ref.chapterId}\u0000${ref.sceneId ?? ""}\u0000${ref.startOffset}\u0000${ref.endOffset}\u0000${ref.contentHash}`;
    const target = `${stage}Refs` as const;
    const existing = new Map(thread[target].map((ref) => [key(ref), ref]));
    for (const ref of parsedRefs) {
      existing.set(key(ref), ref);
    }
    return this.saveThread(projectPath, StoryThreadSchema.parse({ ...thread, [target]: [...existing.values()] }));
  }

  async addSetupEvidence(
    projectPath: string,
    threadId: string,
    refs: EvidenceRef | EvidenceRef[]
  ): Promise<StoryThread> {
    return this.addEvidence(projectPath, threadId, "setup", refs);
  }

  async addProgressEvidence(
    projectPath: string,
    threadId: string,
    refs: EvidenceRef | EvidenceRef[]
  ): Promise<StoryThread> {
    return this.addEvidence(projectPath, threadId, "progress", refs);
  }

  async addPayoffEvidence(
    projectPath: string,
    threadId: string,
    refs: EvidenceRef | EvidenceRef[]
  ): Promise<StoryThread> {
    return this.addEvidence(projectPath, threadId, "payoff", refs);
  }

  async appendEvidence(
    projectPath: string,
    threadId: string,
    stage: StoryThreadStage,
    ref: EvidenceRef
  ): Promise<StoryThread> {
    return this.addEvidence(projectPath, threadId, stage, ref);
  }

  async setStatus(projectPath: string, threadId: string, status: StoryThreadStatus): Promise<StoryThread> {
    const parsedStatus = StoryThreadStatusSchema.parse(status);
    const thread = await this.getThread(projectPath, threadId);
    if (!thread) {
      throw new Error(`Story thread not found: ${threadId}`);
    }
    return this.saveThread(projectPath, StoryThreadSchema.parse({ ...thread, status: parsedStatus }));
  }

  async updateStatus(projectPath: string, threadId: string, status: StoryThreadStatus): Promise<StoryThread> {
    return this.setStatus(projectPath, threadId, status);
  }

  async lockThread(projectPath: string, threadId: string): Promise<StoryThread> {
    const thread = await this.getThread(projectPath, threadId);
    if (!thread) {
      throw new Error(`Story thread not found: ${threadId}`);
    }
    return this.saveThread(projectPath, StoryThreadSchema.parse({ ...thread, locked: true }));
  }

  async unlockThread(projectPath: string, threadId: string): Promise<StoryThread> {
    const thread = await this.getThread(projectPath, threadId);
    if (!thread) {
      throw new Error(`Story thread not found: ${threadId}`);
    }
    return this.saveThread(projectPath, StoryThreadSchema.parse({ ...thread, locked: false }));
  }

  /** Threads whose payoff window has arrived and which are not closed. */
  async listDueThreads(projectPath: string, chapterNumber?: number): Promise<StoryThread[]> {
    const threads = await this.listThreads(projectPath);
    return threads.filter((thread) => {
      if (thread.status === "resolved" || thread.status === "abandoned" || thread.status === "candidate") {
        return false;
      }
      if (thread.status === "due") {
        return true;
      }
      if (chapterNumber === undefined || thread.latestPayoffChapter === undefined) {
        return false;
      }
      return thread.latestPayoffChapter <= chapterNumber;
    });
  }

  async due(projectPath: string, chapterNumber?: number): Promise<StoryThread[]> {
    return this.listDueThreads(projectPath, chapterNumber);
  }

  /** Return an explainable dependency graph; missing dependencies are legal during extraction. */
  async validateDependencies(projectPath: string): Promise<{ valid: boolean; cycles: string[][]; missing: string[] }> {
    const threads = await this.readThreads(projectPath);
    const ids = new Set(threads.map((thread) => thread.id));
    const missing = [...new Set(threads.flatMap((thread) => thread.dependencies.filter((id) => !ids.has(id))))].sort();
    const cycles = findCycles(threads);
    return { valid: cycles.length === 0, cycles, missing };
  }

  /**
   * Import old clues once. Existing authored threads always win, so rerunning
   * this method is safe and does not overwrite edits or create duplicates.
   */
  async migrateLegacyClues(projectPath: string): Promise<StoryThread[]> {
    const current = await this.readThreads(projectPath);
    const existingIds = new Set(current.map((thread) => thread.id));
    const legacy = await this.readLegacyClues(projectPath);
    const migrated = migrateCluesToStoryThreads(legacy).filter((thread) => !existingIds.has(thread.id));
    if (migrated.length === 0) {
      return current.sort(byId);
    }
    const next = [...current, ...migrated];
    await this.writeThreadsWithRollback(projectPath, next);
    return next.sort(byId);
  }

  async importLegacyClues(projectPath: string): Promise<StoryThread[]> {
    return this.migrateLegacyClues(projectPath);
  }

  private async ensureLegacyMigration(projectPath: string): Promise<StoryThread[]> {
    const current = await this.readThreads(projectPath);
    const legacy = await this.readLegacyClues(projectPath);
    if (legacy.length === 0) {
      return current;
    }
    const existingIds = new Set(current.map((thread) => thread.id));
    const missing = migrateCluesToStoryThreads(legacy).filter((thread) => !existingIds.has(thread.id));
    if (missing.length === 0) {
      return current;
    }
    const next = [...current, ...missing];
    await this.writeThreadsWithRollback(projectPath, next);
    return next;
  }

  private async readLegacyClues(projectPath: string): Promise<Clue[]> {
    try {
      const raw = await this.files.readJson<unknown[]>(this.files.assertInsideProject(projectPath, "clues.json"));
      return raw.map((item) => ClueSchema.parse(item));
    } catch (error) {
      if (isMissingFile(error)) {
        return [];
      }
      throw error;
    }
  }

  private async readThreads(projectPath: string): Promise<StoryThread[]> {
    let raw: string;
    try {
      raw = await this.files.readText(this.threadPath(projectPath));
    } catch (error) {
      if (isMissingFile(error)) {
        // Accept the array form produced by the earliest continuation builds.
        try {
          const legacy = await this.files.readJson<unknown[]>(
            this.files.assertInsideProject(projectPath, "canon/story-threads.json")
          );
          return legacy.map((item) => StoryThreadSchema.parse(item));
        } catch (legacyError) {
          if (isMissingFile(legacyError)) {
            return [];
          }
          throw legacyError;
        }
      }
      throw error;
    }
    if (!raw.trim()) {
      return [];
    }
    if (raw.trimStart().startsWith("[")) {
      const value = JSON.parse(raw) as unknown;
      if (!Array.isArray(value)) throw new Error("Invalid story thread JSON array");
      return value.map((item) => StoryThreadSchema.parse(item));
    }
    return raw
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => StoryThreadSchema.parse(JSON.parse(line) as unknown));
  }

  private async writeThreadsWithRollback(projectPath: string, threads: StoryThread[]): Promise<void> {
    const target = this.threadPath(projectPath);
    let previous: string | undefined;
    try {
      previous = await this.files.readText(target);
    } catch (error) {
      if (!isMissingFile(error)) throw error;
      try {
        previous = await this.files.readText(this.files.assertInsideProject(projectPath, "canon/story-threads.json"));
      } catch (legacyError) {
        if (!isMissingFile(legacyError)) throw legacyError;
      }
    }
    const body = threads.length ? `${threads.map((thread) => JSON.stringify(thread)).join("\n")}\n` : "";
    try {
      await this.files.writeTextAtomic(target, body);
    } catch (error) {
      if (previous !== undefined) {
        try {
          await this.files.writeTextAtomic(target, previous);
        } catch {
          // Preserve the original write error; retrying is safe and idempotent.
        }
      }
      throw error;
    }
  }

  private threadPath(projectPath: string): string {
    return this.files.assertInsideProject(projectPath, path.posix.normalize(StoryThreadService.jsonlFile));
  }

  private assertNoDependencyCycle(threads: StoryThread[], changedId: string): void {
    const cycles = findCycles(threads);
    if (cycles.length > 0 && cycles.some((cycle) => cycle.includes(changedId))) {
      throw new Error(`Story thread dependency cycle: ${cycles[0].join(" -> ")}`);
    }
  }
}

const byId = (left: StoryThread, right: StoryThread): number => left.id.localeCompare(right.id);

const asArray = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

const matchesThread = (thread: StoryThread, filter: StoryThreadFilter): boolean => {
  if (filter.id && thread.id !== filter.id) return false;
  if (filter.locked !== undefined && thread.locked !== filter.locked) return false;
  if (filter.relatedEntityId && !thread.relatedEntityIds.includes(filter.relatedEntityId)) return false;
  if (filter.dependencyId && !thread.dependencies.includes(filter.dependencyId)) return false;
  if (filter.type && !asArray(filter.type).includes(thread.type)) return false;
  if (filter.status && !asArray(filter.status).includes(thread.status)) return false;
  if (filter.search) {
    const query = filter.search.trim().toLocaleLowerCase();
    if (query && !`${thread.title}\n${thread.expectedPayoff}\n${thread.notes}`.toLocaleLowerCase().includes(query))
      return false;
  }
  if (filter.dueAtChapter !== undefined) {
    if (
      thread.latestPayoffChapter === undefined ||
      thread.latestPayoffChapter > filter.dueAtChapter ||
      thread.status === "resolved" ||
      thread.status === "abandoned"
    ) {
      return false;
    }
  }
  return true;
};

const upsertById = <T extends { id: string }>(values: T[], value: T): T[] => {
  const index = values.findIndex((candidate) => candidate.id === value.id);
  return index < 0
    ? [...values, value]
    : values.map((candidate, candidateIndex) => (candidateIndex === index ? value : candidate));
};

const findCycles = (threads: StoryThread[]): string[][] => {
  const graph = new Map(threads.map((thread) => [thread.id, thread.dependencies]));
  const cycles: string[][] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  const visit = (id: string) => {
    if (visiting.has(id)) {
      const start = stack.indexOf(id);
      cycles.push([...stack.slice(start), id]);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    stack.push(id);
    for (const dependency of graph.get(id) ?? []) {
      if (graph.has(dependency)) visit(dependency);
    }
    stack.pop();
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of graph.keys()) visit(id);
  return cycles;
};

const isMissingFile = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT";
