import { describe, expect, it } from "vitest";
import { AgentChatSessionSchema, defaultAgentMembers, inkforgeSchemaVersion } from "@inkforge/schemas";
import { MultiAgentRuntimeService } from "./MultiAgentRuntimeService.js";

describe("MultiAgentRuntimeService", () => {
  it("persists independent permissions, transcripts, handoffs and review state", () => {
    const runtime = new MultiAgentRuntimeService();
    const session = AgentChatSessionSchema.parse({
      schemaVersion: inkforgeSchemaVersion,
      id: "session-1",
      projectId: "project-1",
      chapterId: "chapter-1",
      title: "协作测试",
      updatedAt: "2026-07-26T00:00:00.000Z"
    });
    const members = defaultAgentMembers.filter((member) => ["director", "writer", "editor"].includes(member.id));
    const run = runtime.createRun(session, "完成第一章", members, "director", [
      "get_chapter_context",
      "inspect_continuity"
    ]);
    const task = runtime.ensureTask(run, {
      id: "scene-1",
      title: "完成场景一",
      instruction: "写出进入遗迹的场景",
      assignedTo: "writer",
      createdBy: "director"
    });

    expect(run.agents.find((agent) => agent.agentId === "writer")?.allowedTools).toEqual(["get_chapter_context"]);
    runtime.startTask(run, task, "请完成场景一");
    runtime.submitTask(run, task, "场景正文", ["editor"]);
    runtime.approveTask(run, task, "editor", "人物动机成立");

    expect(task.status).toBe("approved");
    expect(run.messages.map((message) => message.kind)).toEqual(["delegation", "handoff", "review"]);
    expect(run.agents.find((agent) => agent.agentId === "writer")?.transcript).toHaveLength(2);
    expect(AgentChatSessionSchema.parse(session).collaborationRuns).toHaveLength(1);

    const nextRun = runtime.createRun(session, "继续讨论", members, "director");
    expect(nextRun.agents.find((agent) => agent.agentId === "writer")?.memory).toContain("完成场景一：场景正文");
    expect(nextRun.agents.find((agent) => agent.agentId === "writer")?.transcript).toHaveLength(2);
  });

  it("supports bounded rework instead of silently looping", () => {
    const runtime = new MultiAgentRuntimeService();
    const session = AgentChatSessionSchema.parse({
      schemaVersion: inkforgeSchemaVersion,
      id: "session-1",
      projectId: "project-1",
      chapterId: "chapter-1",
      title: "返工测试",
      updatedAt: "2026-07-26T00:00:00.000Z"
    });
    const members = defaultAgentMembers.filter((member) => ["director", "writer"].includes(member.id));
    const run = runtime.createRun(session, "写场景", members, "director");
    const task = runtime.ensureTask(run, {
      title: "写场景",
      instruction: "完成正文",
      assignedTo: "writer",
      createdBy: "director",
      maxAttempts: 2
    });

    expect(runtime.requestRework(run, task, "director", "缺少关键事实")).toBe(true);
    expect(task.attempt).toBe(2);
    expect(runtime.requestRework(run, task, "director", "仍不完整")).toBe(false);
    expect(task.status).toBe("failed");
  });
});
