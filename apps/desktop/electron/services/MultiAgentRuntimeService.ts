import { randomUUID } from "node:crypto";
import type {
  AgentChatSession,
  AgentCollaborationRun,
  AgentCollaborationTask,
  AgentMember,
  AgentToolName
} from "@inkforge/schemas";

interface CollaborationTaskInput {
  id?: string;
  title: string;
  instruction: string;
  assignedTo: string;
  createdBy: string;
  dependencies?: string[];
  maxAttempts?: number;
}

const runtimeId = (prefix: string): string => `${prefix}_${randomUUID()}`;

export class MultiAgentRuntimeService {
  createRun(
    session: AgentChatSession,
    request: string,
    members: AgentMember[],
    coordinatorId: string,
    globalAllowedTools?: AgentToolName[]
  ): AgentCollaborationRun {
    const now = new Date().toISOString();
    const globalPermissions = globalAllowedTools ? new Set(globalAllowedTools) : undefined;
    const previousStates = new Map<string, AgentCollaborationRun["agents"][number]>();
    for (const previousRun of [...session.collaborationRuns].reverse()) {
      for (const state of previousRun.agents) {
        if (!previousStates.has(state.agentId)) {
          previousStates.set(state.agentId, state);
        }
      }
    }
    const run: AgentCollaborationRun = {
      id: runtimeId("collaboration"),
      request,
      coordinatorId,
      participantIds: members.map((member) => member.id),
      status: "running",
      tasks: [],
      messages: [],
      agents: members.map((member) => {
        const previous = previousStates.get(member.id);
        return {
          agentId: member.id,
          status: "idle" as const,
          allowedTools: member.allowedTools.filter((tool) => !globalPermissions || globalPermissions.has(tool)),
          memory: previous?.memory.slice(-6) ?? [],
          transcript: previous?.transcript.slice(-8) ?? []
        };
      }),
      createdAt: now,
      updatedAt: now
    };
    session.collaborationRuns.push(run);
    return run;
  }

  findRun(session: AgentChatSession, runId: string | undefined): AgentCollaborationRun | undefined {
    return runId ? session.collaborationRuns.find((run) => run.id === runId) : undefined;
  }

  ensureTask(run: AgentCollaborationRun, input: CollaborationTaskInput): AgentCollaborationTask {
    const existing = input.id ? run.tasks.find((task) => task.id === input.id) : undefined;
    if (existing) {
      return existing;
    }
    const assignee = this.agent(run, input.assignedTo);
    const now = new Date().toISOString();
    const task: AgentCollaborationTask = {
      id: input.id ?? runtimeId("task"),
      title: input.title,
      instruction: input.instruction,
      assignedTo: input.assignedTo,
      createdBy: input.createdBy,
      status: "pending",
      dependencies: input.dependencies ?? [],
      allowedTools: [...assignee.allowedTools],
      attempt: 1,
      maxAttempts: input.maxAttempts ?? 2,
      result: "",
      feedback: "",
      createdAt: now,
      updatedAt: now
    };
    run.tasks.push(task);
    this.send(run, input.createdBy, [input.assignedTo], "delegation", input.instruction, task.id);
    this.touch(run);
    return task;
  }

  startTask(run: AgentCollaborationRun, task: AgentCollaborationTask, prompt: string): void {
    const blocked = task.dependencies.some(
      (dependency) => run.tasks.find((item) => item.id === dependency)?.status !== "approved"
    );
    if (blocked) {
      throw new Error(`协作任务“${task.title}”的依赖尚未通过验收。`);
    }
    task.status = "running";
    task.updatedAt = new Date().toISOString();
    const agent = this.agent(run, task.assignedTo);
    agent.status = "working";
    agent.activeTaskId = task.id;
    agent.transcript.push({
      id: runtimeId("turn"),
      taskId: task.id,
      role: "user",
      content: prompt,
      createdAt: task.updatedAt
    });
    this.trimAgent(agent);
    this.touch(run);
  }

  submitTask(run: AgentCollaborationRun, task: AgentCollaborationTask, result: string, handoffTo: string[] = []): void {
    const now = new Date().toISOString();
    task.result = result;
    task.status = "submitted";
    task.updatedAt = now;
    const agent = this.agent(run, task.assignedTo);
    agent.status = "waiting";
    agent.activeTaskId = undefined;
    agent.transcript.push({
      id: runtimeId("turn"),
      taskId: task.id,
      role: "assistant",
      content: result,
      createdAt: now
    });
    agent.memory.push(`${task.title}：${result.slice(0, 2_000)}`);
    this.trimAgent(agent);
    if (handoffTo.length) {
      this.send(run, task.assignedTo, handoffTo, "handoff", result, task.id);
    }
    this.touch(run);
  }

  approveTask(run: AgentCollaborationRun, task: AgentCollaborationTask, reviewerId: string, note = ""): void {
    task.status = "approved";
    task.feedback = note;
    task.updatedAt = new Date().toISOString();
    const agent = this.agent(run, task.assignedTo);
    agent.status = "idle";
    this.send(run, reviewerId, [task.assignedTo], "review", note || "任务已通过验收。", task.id);
    this.touch(run);
  }

  requestRework(
    run: AgentCollaborationRun,
    task: AgentCollaborationTask,
    reviewerId: string,
    feedback: string
  ): boolean {
    if (task.attempt >= task.maxAttempts) {
      task.status = "failed";
      task.feedback = feedback;
      this.agent(run, task.assignedTo).status = "failed";
      this.send(run, reviewerId, [task.assignedTo], "feedback", `已达到返工上限：${feedback}`, task.id);
      this.touch(run);
      return false;
    }
    task.attempt += 1;
    task.status = "rework";
    task.feedback = feedback;
    task.updatedAt = new Date().toISOString();
    this.agent(run, task.assignedTo).status = "waiting";
    this.send(run, reviewerId, [task.assignedTo], "feedback", feedback, task.id);
    this.touch(run);
    return true;
  }

  failTask(run: AgentCollaborationRun, task: AgentCollaborationTask, error: string): void {
    task.status = "failed";
    task.feedback = error;
    task.updatedAt = new Date().toISOString();
    this.agent(run, task.assignedTo).status = "failed";
    this.send(run, task.assignedTo, [run.coordinatorId], "status", error, task.id);
    run.status = "failed";
    this.touch(run);
  }

  completeRun(run: AgentCollaborationRun): void {
    run.status = run.tasks.some((task) => task.status === "failed") ? "failed" : "completed";
    for (const agent of run.agents) {
      if (agent.status !== "failed") {
        agent.status = "idle";
        agent.activeTaskId = undefined;
      }
    }
    this.touch(run);
  }

  agentContext(run: AgentCollaborationRun, agentId: string): string {
    const agent = this.agent(run, agentId);
    const memories = agent.memory.slice(-6);
    const transcript = agent.transcript.slice(-8);
    return [
      memories.length ? `你的长期工作记忆：\n${memories.map((item) => `- ${item}`).join("\n")}` : "",
      transcript.length
        ? `你的最近独立会话：\n${transcript
            .map((turn) => `${turn.role === "assistant" ? "你" : "任务方"}：${turn.content.slice(-1_200)}`)
            .join("\n")}`
        : ""
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  recordPrivateTurn(
    run: AgentCollaborationRun,
    agentId: string,
    role: "system" | "user" | "assistant" | "tool",
    content: string,
    taskId?: string
  ): void {
    const agent = this.agent(run, agentId);
    agent.transcript.push({
      id: runtimeId("turn"),
      taskId,
      role,
      content,
      createdAt: new Date().toISOString()
    });
    this.trimAgent(agent);
    this.touch(run);
  }

  send(
    run: AgentCollaborationRun,
    fromAgentId: string,
    toAgentIds: string[],
    kind: "delegation" | "handoff" | "review" | "feedback" | "status",
    content: string,
    taskId?: string
  ): void {
    run.messages.push({
      id: runtimeId("peer_message"),
      taskId,
      fromAgentId,
      toAgentIds,
      kind,
      content,
      createdAt: new Date().toISOString()
    });
    if (run.messages.length > 120) {
      run.messages.splice(0, run.messages.length - 120);
    }
    this.touch(run);
  }

  private agent(run: AgentCollaborationRun, agentId: string) {
    const agent = run.agents.find((item) => item.agentId === agentId);
    if (!agent) {
      throw new Error(`协作运行中不存在 Agent：${agentId}`);
    }
    return agent;
  }

  private trimAgent(agent: AgentCollaborationRun["agents"][number]): void {
    if (agent.memory.length > 12) {
      agent.memory.splice(0, agent.memory.length - 12);
    }
    if (agent.transcript.length > 40) {
      agent.transcript.splice(0, agent.transcript.length - 40);
    }
  }

  private touch(run: AgentCollaborationRun): void {
    run.updatedAt = new Date().toISOString();
  }
}
