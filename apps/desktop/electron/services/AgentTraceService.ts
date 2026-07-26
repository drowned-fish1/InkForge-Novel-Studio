import path from "node:path";
import { AgentRunTraceSchema, type AgentRunTrace } from "@inkforge/schemas";
import { FileRepository } from "./FileRepository.js";

const maxTracesPerChapter = 50;

export class AgentTraceService {
  constructor(private readonly files = new FileRepository()) {}

  async list(projectPath: string, chapterId: string): Promise<AgentRunTrace[]> {
    try {
      const value = await this.files.readJson<unknown[]>(this.tracePath(projectPath, chapterId));
      return value
        .map((item) => AgentRunTraceSchema.parse(item))
        .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
    } catch (error) {
      if (isMissingFile(error)) {
        return [];
      }
      throw error;
    }
  }

  async save(projectPath: string, trace: AgentRunTrace): Promise<AgentRunTrace> {
    const parsed = AgentRunTraceSchema.parse(trace);
    const traces = await this.list(projectPath, parsed.chapterId);
    const next = [parsed, ...traces.filter((item) => item.id !== parsed.id)]
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
      .slice(0, maxTracesPerChapter);
    await this.files.writeJsonAtomic(this.tracePath(projectPath, parsed.chapterId), next);
    return parsed;
  }

  async find(projectPath: string, chapterId: string, traceId: string): Promise<AgentRunTrace | undefined> {
    return (await this.list(projectPath, chapterId)).find((item) => item.id === traceId);
  }

  private tracePath(projectPath: string, chapterId: string): string {
    return this.files.assertInsideProject(
      projectPath,
      path.posix.join(".inkforge", "agents", "traces", `${safeId(chapterId)}.json`)
    );
  }
}

const safeId = (value: string): string => value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "chapter";

const isMissingFile = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT";
