import { createHash } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { FileRepository } from "./FileRepository.js";

interface RecordShape {
  id: string;
  chapterId: string;
  updatedAt: string;
  branchId?: string;
  status: string;
  validation?: { hardFailures: number };
}
const entrySchema = z.object({
  id: z.string().min(1),
  chapterId: z.string(),
  updatedAt: z.string(),
  branchId: z.string().optional(),
  status: z.string(),
  validation: z.object({ hardFailures: z.number() }).optional()
});
const indexSchema = z.object({ schemaVersion: z.literal(2), runs: z.array(entrySchema) });
const missing = (error: unknown) =>
  Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
export class ContinuationRunStore<T extends RecordShape> {
  private static queues = new Map<string, Promise<unknown>>();
  constructor(
    private readonly files: FileRepository,
    private readonly parse: (raw: unknown) => T
  ) {}
  private file(project: string, relative: string) {
    return this.files.assertInsideProject(project, `.inkforge/continuation/${relative}`);
  }
  private recordFile(project: string, id: string) {
    return this.file(project, `records/${createHash("sha256").update(id).digest("hex")}.json`);
  }
  private summary(run: RecordShape) {
    return entrySchema.parse({
      ...run,
      validation: run.validation ? { hardFailures: run.validation.hardFailures } : undefined
    });
  }
  async summaries(project: string): Promise<RecordShape[]> {
    try {
      return indexSchema.parse(await this.files.readJson(this.file(project, "index.json"))).runs;
    } catch (error) {
      if (!missing(error)) throw error;
    }
    try {
      const legacy = await this.files.readJson<unknown>(this.file(project, "runs.json"));
      if (!Array.isArray(legacy)) throw new Error("Invalid continuation run store.");
      return legacy as RecordShape[];
    } catch (error) {
      if (missing(error)) return [];
      throw error;
    }
  }
  private async locked<R>(project: string, action: () => Promise<R>): Promise<R> {
    const resolved = path.resolve(project);
    const key = process.platform === "win32" ? resolved.toLowerCase() : resolved;
    const next = (ContinuationRunStore.queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(action);
    ContinuationRunStore.queues.set(key, next);
    try {
      return await next;
    } finally {
      if (ContinuationRunStore.queues.get(key) === next) ContinuationRunStore.queues.delete(key);
    }
  }
  private async index(project: string) {
    try {
      return indexSchema.parse(await this.files.readJson(this.file(project, "index.json")));
    } catch (error) {
      if (!missing(error)) throw error;
    }
    const old = await this.summaries(project);
    const runs: T[] = old.flatMap((raw) => {
      try {
        return [this.parse(raw)];
      } catch {
        return [];
      }
    });
    for (const run of runs) await this.files.writeJsonAtomic(this.recordFile(project, run.id), run);
    const index = { schemaVersion: 2 as const, runs: runs.map((run) => this.summary(run)) };
    await this.files.writeJsonAtomic(this.file(project, "index.json"), index);
    return index;
  }
  async list(project: string): Promise<T[]> {
    const index = await this.locked(project, () => this.index(project));
    return Promise.all(
      index.runs.slice(0, 100).map((entry) => this.files.readJson(this.recordFile(project, entry.id)).then(this.parse))
    );
  }
  async get(project: string, id: string): Promise<T | undefined> {
    await this.locked(project, () => this.index(project));
    try {
      const run = this.parse(await this.files.readJson(this.recordFile(project, id)));
      if (run.id !== id) throw new Error("Continuation record id mismatch.");
      return run;
    } catch (error) {
      if (missing(error)) return undefined;
      throw error;
    }
  }
  async save(project: string, run: T) {
    await this.locked(project, async () => {
      const index = await this.index(project);
      await this.files.writeJsonAtomic(this.recordFile(project, run.id), run);
      index.runs = [this.summary(run), ...index.runs.filter((entry) => entry.id !== run.id)].sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt)
      );
      await this.files.writeJsonAtomic(this.file(project, "index.json"), index);
    });
  }
}
