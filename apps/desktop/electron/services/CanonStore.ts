import {
  CanonFactSchema,
  CanonFactStatusSchema,
  EvidenceRefSchema,
  StateTransitionSchema,
  StyleProfileSchema,
  type CanonFact,
  type CanonFactStatus,
  type EvidenceRef,
  type StateTransition,
  type StyleProfile
} from "@inkforge/schemas";
import path from "node:path";
import { FileRepository } from "./FileRepository.js";

export type ChapterOrder = readonly string[] | Readonly<Record<string, number>> | ReadonlyMap<string, number>;

export interface CanonFactFilter {
  id?: string;
  subjectId?: string;
  predicate?: string;
  status?: CanonFactStatus | CanonFactStatus[];
  minCertainty?: number;
  maxCertainty?: number;
  authorLockedOnly?: boolean;
}

export interface StateTransitionFilter {
  id?: string;
  subjectId?: string;
  predicate?: string;
  chapterId?: string;
}

/**
 * Durable source-of-truth storage for author-reviewed continuation data.
 * Facts and transitions use JSONL so a single record can be recovered or
 * migrated without loading the whole corpus. Each write is an atomic rename
 * through FileRepository and is idempotent by record id.
 */
export class CanonStore {
  private readonly mutationChains = new Map<string, Promise<void>>();

  constructor(private readonly files = new FileRepository()) {}

  async listFacts(projectPath: string, filter: CanonFactFilter = {}): Promise<CanonFact[]> {
    const facts = await this.readJsonl(projectPath, "canon/facts.jsonl", CanonFactSchema);
    return facts.filter((fact) => matchesFact(fact, filter)).sort(byId);
  }

  async getFact(projectPath: string, factId: string): Promise<CanonFact | undefined> {
    return (await this.listFacts(projectPath, { id: factId }))[0];
  }

  async saveFact(projectPath: string, fact: CanonFact): Promise<CanonFact> {
    const parsed = CanonFactSchema.parse(fact);
    return this.enqueueMutation(`${path.resolve(projectPath)}:facts`, async () => {
      const current = await this.readJsonl(projectPath, "canon/facts.jsonl", CanonFactSchema);
      const next = upsertById(current, parsed);
      await this.writeJsonlWithRollback(projectPath, "canon/facts.jsonl", next);
      return parsed;
    });
  }

  async upsertFact(projectPath: string, fact: CanonFact): Promise<CanonFact> {
    return this.saveFact(projectPath, fact);
  }

  async deleteFact(projectPath: string, factId: string): Promise<boolean> {
    return this.enqueueMutation(`${path.resolve(projectPath)}:facts`, async () => {
      const current = await this.readJsonl(projectPath, "canon/facts.jsonl", CanonFactSchema);
      const next = current.filter((fact) => fact.id !== factId);
      if (next.length === current.length) return false;
      await this.writeJsonlWithRollback(projectPath, "canon/facts.jsonl", next);
      return true;
    });
  }

  /** Change review state while preserving the original fact and evidence. */
  async setFactStatus(projectPath: string, factId: string, status: CanonFactStatus): Promise<CanonFact> {
    const parsedStatus = CanonFactStatusSchema.parse(status);
    return this.enqueueMutation(`${path.resolve(projectPath)}:facts`, async () => {
      const facts = await this.readJsonl(projectPath, "canon/facts.jsonl", CanonFactSchema);
      const current = facts.find((fact) => fact.id === factId);
      if (!current) throw new Error(`Canon fact not found: ${factId}`);
      const updated = CanonFactSchema.parse({ ...current, status: parsedStatus, updatedAt: new Date().toISOString() });
      await this.writeJsonlWithRollback(projectPath, "canon/facts.jsonl", upsertById(facts, updated));
      return updated;
    });
  }

  async confirmFact(projectPath: string, factId: string): Promise<CanonFact> {
    return this.setFactStatus(projectPath, factId, "confirmed");
  }

  async lockFact(projectPath: string, factId: string): Promise<CanonFact> {
    return this.setFactStatus(projectPath, factId, "author_locked");
  }

  async markFactConflicted(projectPath: string, factId: string): Promise<CanonFact> {
    return this.setFactStatus(projectPath, factId, "conflicted");
  }

  async rejectFact(projectPath: string, factId: string): Promise<CanonFact> {
    return this.setFactStatus(projectPath, factId, "rejected");
  }

  /**
   * Return facts whose inclusive validity range contains chapterId. When
   * chapter identifiers contain a numeric suffix (chapter-0007, c7, ...),
   * the suffix supplies a natural order. Callers with opaque ids can pass a
   * sequence/map explicitly.
   */
  async listFactsAtChapter(projectPath: string, chapterId: string, order?: ChapterOrder): Promise<CanonFact[]> {
    const facts = await this.listFacts(projectPath);
    return facts.filter((fact) => isFactValidAtChapter(fact, chapterId, order));
  }

  async queryFactsAtChapter(projectPath: string, chapterId: string, order?: ChapterOrder): Promise<CanonFact[]> {
    return this.listFactsAtChapter(projectPath, chapterId, order);
  }

  async getFactsAtChapter(projectPath: string, chapterId: string, order?: ChapterOrder): Promise<CanonFact[]> {
    return this.listFactsAtChapter(projectPath, chapterId, order);
  }

  async listStateTransitions(projectPath: string, filter: StateTransitionFilter = {}): Promise<StateTransition[]> {
    const transitions = await this.readJsonl(projectPath, "canon/state-transitions.jsonl", StateTransitionSchema);
    return transitions.filter((transition) => matchesTransition(transition, filter)).sort(byTransitionOrder);
  }

  async getStateTransition(projectPath: string, transitionId: string): Promise<StateTransition | undefined> {
    return (await this.listStateTransitions(projectPath, { id: transitionId }))[0];
  }

  async saveStateTransition(projectPath: string, transition: StateTransition): Promise<StateTransition> {
    const parsed = StateTransitionSchema.parse(transition);
    return this.enqueueMutation(`${path.resolve(projectPath)}:transitions`, async () => {
      const current = await this.readJsonl(projectPath, "canon/state-transitions.jsonl", StateTransitionSchema);
      const next = upsertById(current, parsed);
      await this.writeJsonlWithRollback(projectPath, "canon/state-transitions.jsonl", next);
      return parsed;
    });
  }

  async upsertStateTransition(projectPath: string, transition: StateTransition): Promise<StateTransition> {
    return this.saveStateTransition(projectPath, transition);
  }

  async deleteStateTransition(projectPath: string, transitionId: string): Promise<boolean> {
    return this.enqueueMutation(`${path.resolve(projectPath)}:transitions`, async () => {
      const current = await this.readJsonl(projectPath, "canon/state-transitions.jsonl", StateTransitionSchema);
      const next = current.filter((transition) => transition.id !== transitionId);
      if (next.length === current.length) return false;
      await this.writeJsonlWithRollback(projectPath, "canon/state-transitions.jsonl", next);
      return true;
    });
  }

  /** Return the latest transition for each predicate at or before a chapter. */
  async listStateAtChapter(
    projectPath: string,
    subjectId: string,
    chapterId: string,
    order?: ChapterOrder
  ): Promise<StateTransition[]> {
    const transitions = await this.listStateTransitions(projectPath, { subjectId });
    const at = chapterPosition(chapterId, order);
    const eligible = transitions.filter((transition) => {
      const position = chapterPosition(transition.chapterId, order);
      return typeof at === "number" && typeof position === "number"
        ? position <= at
        : transition.chapterId === chapterId;
    });
    const latest = new Map<string, StateTransition>();
    for (const transition of eligible) {
      const current = latest.get(transition.predicate);
      if (!current || compareTransitions(current, transition, order) < 0) {
        latest.set(transition.predicate, transition);
      }
    }
    return [...latest.values()].sort((left, right) => left.predicate.localeCompare(right.predicate));
  }

  async getStyleProfile(projectPath: string): Promise<StyleProfile | undefined> {
    try {
      const raw = await this.files.readJson<unknown>(this.jsonPath(projectPath, "canon/style-profile.json"));
      return StyleProfileSchema.parse(raw);
    } catch (error) {
      if (isMissingFile(error)) {
        return undefined;
      }
      throw error;
    }
  }

  async saveStyleProfile(projectPath: string, profile: StyleProfile): Promise<StyleProfile> {
    const parsed = StyleProfileSchema.parse(profile);
    const target = this.jsonPath(projectPath, "canon/style-profile.json");
    let previous: string | undefined;
    try {
      previous = await this.files.readText(target);
    } catch (error) {
      if (!isMissingFile(error)) {
        throw error;
      }
    }
    try {
      await this.files.writeJsonAtomic(target, parsed);
    } catch (error) {
      if (previous !== undefined) {
        await this.tryRestore(target, previous);
      }
      throw error;
    }
    return parsed;
  }

  async deleteStyleProfile(projectPath: string): Promise<boolean> {
    const profile = await this.getStyleProfile(projectPath);
    if (!profile) {
      return false;
    }
    // Keep deletion recoverable and platform-safe: an empty JSON object is a
    // valid default profile and avoids a destructive unlink operation.
    await this.files.writeJsonAtomic(this.jsonPath(projectPath, "canon/style-profile.json"), {});
    return true;
  }

  /** Validate a caller-provided pointer before it enters persisted data. */
  validateEvidence(ref: EvidenceRef): EvidenceRef {
    return EvidenceRefSchema.parse(ref);
  }

  private jsonPath(projectPath: string, relativePath: string): string {
    return this.files.assertInsideProject(projectPath, path.posix.normalize(relativePath));
  }

  private async readJsonl<T>(
    projectPath: string,
    relativePath: string,
    schema: { parse: (value: unknown) => T }
  ): Promise<T[]> {
    let raw: string;
    try {
      raw = await this.files.readText(this.jsonPath(projectPath, relativePath));
    } catch (error) {
      if (isMissingFile(error)) {
        // A pre-release importer wrote JSON arrays. Accept them once so users
        // can upgrade without a migration command, while all future writes
        // use JSONL.
        const legacy = await this.tryReadLegacyArray(projectPath, relativePath, schema);
        return legacy;
      }
      throw error;
    }
    if (!raw.trim()) {
      return [];
    }
    if (raw.trimStart().startsWith("[")) {
      const value = JSON.parse(raw) as unknown;
      if (!Array.isArray(value)) {
        throw new Error(`Expected JSONL array at ${relativePath}`);
      }
      return value.map((item) => schema.parse(item));
    }
    return raw
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => schema.parse(JSON.parse(line) as unknown));
  }

  private async tryReadLegacyArray<T>(
    projectPath: string,
    relativePath: string,
    schema: { parse: (value: unknown) => T }
  ): Promise<T[]> {
    const legacyPath = this.jsonPath(projectPath, relativePath.replace(/\.jsonl$/u, ".json"));
    try {
      const value = await this.files.readJson<unknown>(legacyPath);
      if (!Array.isArray(value)) {
        return [];
      }
      return value.map((item) => schema.parse(item));
    } catch (error) {
      if (isMissingFile(error)) {
        return [];
      }
      throw error;
    }
  }

  private async writeJsonlWithRollback<T>(projectPath: string, relativePath: string, values: T[]): Promise<void> {
    const target = this.jsonPath(projectPath, relativePath);
    let previous: string | undefined;
    try {
      previous = await this.files.readText(target);
    } catch (error) {
      if (!isMissingFile(error)) {
        throw error;
      }
      // If the JSONL file does not exist, preserve a legacy JSON snapshot for
      // rollback too. This is useful when an upgrade is interrupted.
      try {
        previous = await this.files.readText(this.jsonPath(projectPath, relativePath.replace(/\.jsonl$/u, ".json")));
      } catch (legacyError) {
        if (!isMissingFile(legacyError)) {
          throw legacyError;
        }
      }
    }
    const body = values.length > 0 ? `${values.map((value) => JSON.stringify(value)).join("\n")}\n` : "";
    try {
      await this.files.writeTextAtomic(target, body);
    } catch (error) {
      if (previous !== undefined) {
        await this.tryRestore(target, previous);
      }
      throw error;
    }
  }

  private async tryRestore(target: string, contents: string): Promise<void> {
    try {
      await this.files.writeTextAtomic(target, contents);
    } catch {
      // Preserve the original write error. A caller can retry the operation;
      // no partial temp file is exposed by FileRepository's atomic primitive.
    }
  }

  private enqueueMutation<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationChains.get(key) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    const tail = result.then(
      () => undefined,
      () => undefined
    );
    this.mutationChains.set(key, tail);
    void tail.finally(() => {
      if (this.mutationChains.get(key) === tail) this.mutationChains.delete(key);
    });
    return result;
  }
}

const byId = <T extends { id: string }>(left: T, right: T): number => left.id.localeCompare(right.id);

const byTransitionOrder = (left: StateTransition, right: StateTransition): number =>
  (left.sequence ?? Number.MAX_SAFE_INTEGER) - (right.sequence ?? Number.MAX_SAFE_INTEGER) ||
  left.chapterId.localeCompare(right.chapterId) ||
  left.id.localeCompare(right.id);

const upsertById = <T extends { id: string }>(values: T[], value: T): T[] => {
  const index = values.findIndex((candidate) => candidate.id === value.id);
  return index < 0
    ? [...values, value]
    : values.map((candidate, candidateIndex) => (candidateIndex === index ? value : candidate));
};

const matchesFact = (fact: CanonFact, filter: CanonFactFilter): boolean => {
  if (filter.id && fact.id !== filter.id) return false;
  if (filter.subjectId && fact.subjectId !== filter.subjectId) return false;
  if (filter.predicate && fact.predicate !== filter.predicate) return false;
  if (filter.authorLockedOnly && fact.status !== "author_locked") return false;
  if (filter.status) {
    const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
    if (!statuses.includes(fact.status)) return false;
  }
  if (filter.minCertainty !== undefined && fact.certainty < filter.minCertainty) return false;
  if (filter.maxCertainty !== undefined && fact.certainty > filter.maxCertainty) return false;
  return true;
};

const matchesTransition = (transition: StateTransition, filter: StateTransitionFilter): boolean =>
  (!filter.id || transition.id === filter.id) &&
  (!filter.subjectId || transition.subjectId === filter.subjectId) &&
  (!filter.predicate || transition.predicate === filter.predicate) &&
  (!filter.chapterId || transition.chapterId === filter.chapterId);

const isFactValidAtChapter = (fact: CanonFact, chapterId: string, order?: ChapterOrder): boolean => {
  const at = chapterPosition(chapterId, order);
  if (fact.validFromChapterId) {
    const from = chapterPosition(fact.validFromChapterId, order);
    if (typeof at === "number" && typeof from === "number" ? at < from : chapterId !== fact.validFromChapterId)
      return false;
  }
  if (fact.validToChapterId) {
    const to = chapterPosition(fact.validToChapterId, order);
    if (typeof at === "number" && typeof to === "number" ? at > to : chapterId !== fact.validToChapterId) return false;
  }
  return true;
};

const chapterPosition = (chapterId: string, order?: ChapterOrder): number | string => {
  if (Array.isArray(order)) {
    const index = order.indexOf(chapterId);
    if (index >= 0) return index;
  } else if (order instanceof Map) {
    const value = order.get(chapterId);
    if (value !== undefined) return value;
  } else if (order && Object.prototype.hasOwnProperty.call(order, chapterId)) {
    return (order as Readonly<Record<string, number>>)[chapterId];
  }
  const suffix = /(?:^|[-_])(?:chapter|ch|c)?[-_]?([0-9]+)$/iu.exec(chapterId);
  return suffix ? Number(suffix[1]) : chapterId;
};

const compareTransitions = (left: StateTransition, right: StateTransition, order?: ChapterOrder): number => {
  const leftPosition = chapterPosition(left.chapterId, order);
  const rightPosition = chapterPosition(right.chapterId, order);
  if (typeof leftPosition === "number" && typeof rightPosition === "number" && leftPosition !== rightPosition) {
    return leftPosition - rightPosition;
  }
  return (left.sequence ?? 0) - (right.sequence ?? 0) || left.id.localeCompare(right.id);
};

const isMissingFile = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT";
