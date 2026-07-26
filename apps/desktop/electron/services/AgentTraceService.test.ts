import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentRunTrace } from "@inkforge/schemas";
import { AgentTraceService } from "./AgentTraceService.js";

const created: string[] = [];

afterEach(async () => {
  for (const directory of created.splice(0)) {
    if (path.resolve(directory).startsWith(path.resolve(os.tmpdir()))) {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

const trace = (id: string, startedAt: string): AgentRunTrace => ({
  schemaVersion: "0.1.0",
  id,
  requestId: `request-${id}`,
  chapterId: "chapter-1",
  userMessage: "继续写",
  status: "completed",
  model: "test-model",
  startedAt,
  completedAt: startedAt,
  durationMs: 12,
  usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
  events: [],
  error: ""
});

describe("AgentTraceService", () => {
  it("persists traces newest first and replaces an existing trace id", async () => {
    const projectPath = await mkdtemp(path.join(os.tmpdir(), "inkforge-traces-"));
    created.push(projectPath);
    const service = new AgentTraceService();

    await service.save(projectPath, trace("older", "2026-01-01T00:00:00.000Z"));
    await service.save(projectPath, trace("newer", "2026-01-02T00:00:00.000Z"));
    await service.save(projectPath, {
      ...trace("older", "2026-01-03T00:00:00.000Z"),
      durationMs: 99
    });

    const traces = await service.list(projectPath, "chapter-1");
    expect(traces.map((item) => item.id)).toEqual(["older", "newer"]);
    expect(traces[0].durationMs).toBe(99);
  });
});
