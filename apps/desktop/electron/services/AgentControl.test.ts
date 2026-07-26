import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AgentToolNameSchema,
  agentToolRegistry,
  estimateTokensCjkAware,
  proposalAgentToolNames
} from "@inkforge/schemas";
import { ChatAgentService, compactAgentSession } from "./ChatAgentService.js";
import { FileRepository } from "./FileRepository.js";
import { LibraryService } from "./LibraryService.js";
import { ProjectService } from "./ProjectService.js";
import { StoryStateService } from "./StoryStateService.js";

const temporaryRoots: string[] = [];

const createProjectFixture = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inkforge-agentctl-"));
  temporaryRoots.push(root);
  const files = new FileRepository();
  const projects = new ProjectService(files);
  const project = await projects.createProject(root, {
    title: "控制测试",
    author: "tester",
    genre: [],
    targetWords: 100000,
    style: "",
    protagonist: "",
    premise: ""
  });
  return { files, projects, project };
};

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("agent tool registry", () => {
  it("covers exactly the AgentToolNameSchema enum", () => {
    const registryNames = Object.keys(agentToolRegistry).sort();
    const enumNames = [...AgentToolNameSchema.options].sort();
    expect(registryNames).toEqual(enumNames);
  });

  it("classifies every propose_* tool as proposal and everything else read-only", () => {
    for (const name of AgentToolNameSchema.options) {
      if (name.startsWith("propose_")) {
        expect(proposalAgentToolNames.has(name)).toBe(true);
        expect(agentToolRegistry[name].kind).toBe("proposal");
      } else {
        expect(proposalAgentToolNames.has(name)).toBe(false);
        expect(agentToolRegistry[name].kind).toBe("read");
      }
    }
  });
});

describe("estimateTokensCjkAware", () => {
  it("weights CJK characters heavier than latin", () => {
    const cjk = estimateTokensCjkAware("这是一个中文句子");
    const latin = estimateTokensCjkAware("abcdefgh");
    expect(cjk).toBeGreaterThan(latin);
    expect(estimateTokensCjkAware("")).toBe(1);
  });
});

describe("compactAgentSession", () => {
  it("caps persisted messages while keeping proposals", () => {
    const now = new Date().toISOString();
    const session = {
      schemaVersion: "0.1.0" as const,
      id: "agent_test",
      projectId: "p",
      chapterId: "ch-0001",
      title: "t",
      messages: Array.from({ length: 400 }, (_, index) => ({
        id: `m-${index}`,
        role: "assistant" as const,
        content: `message-${index}`,
        createdAt: now
      })),
      proposals: [],
      dataProposals: [],
      collaborationRuns: [],
      branches: [{ id: "main", title: "主会话", createdAt: now }],
      activeBranchId: "main",
      updatedAt: now
    };
    const compacted = compactAgentSession(session);
    expect(compacted.messages.length).toBe(240);
    expect(compacted.messages[0].id).toBe("m-160");
    expect(compacted.messages.at(-1)?.id).toBe("m-399");
    // Below the cap sessions pass through untouched.
    expect(compactAgentSession({ ...session, messages: session.messages.slice(0, 10) }).messages).toHaveLength(10);
  });
});

describe("ChatAgentService controls", () => {
  it("estimateRun respects the context token budget and marks results as estimates", async () => {
    const { files, projects, project } = await createProjectFixture();
    const mockAi = {
      runAgentCompletion: async () => {
        throw new Error("estimate must not call the provider");
      },
      cancelTask: () => undefined,
      getStatus: async () => ({
        configured: true,
        providerId: "test",
        displayName: "Test",
        baseUrl: "http://localhost",
        model: "test-model",
        authMode: "none" as const,
        maxTokens: 8_192,
        inputPricePerMillion: 2,
        outputPricePerMillion: 10
      })
    };
    const service = new ChatAgentService(
      files,
      projects,
      new LibraryService(files),
      new StoryStateService(files, projects),
      mockAi as never
    );
    const chapterId = project.outline.volumes[0].chapters[0].id;

    const small = await service.estimateRun({
      projectPath: project.projectPath,
      chapterId,
      message: "续写一段",
      context: { tokenBudget: 800 },
      limits: {}
    });
    expect(small.estimated).toBe(true);
    expect(small.contextTokens).toBeLessThanOrEqual(800);
    expect(small.promptTokens).toBeGreaterThan(small.contextTokens);
    expect(small.maxCompletionTokens).toBe(8_192);
    expect(small.estimatedCost).toBeGreaterThan(0);
  });

  it("denies a tool call when the author rejects a per-call approval", async () => {
    const { files, projects, project } = await createProjectFixture();
    const completions = [
      {
        message: {
          role: "assistant" as const,
          content: "",
          tool_calls: [
            {
              id: "call-1",
              type: "function" as const,
              function: { name: "get_outline_context", arguments: "{}" }
            }
          ]
        },
        model: "mock",
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
      },
      {
        message: { role: "assistant" as const, content: "好的，我不读取大纲，直接回答。" },
        model: "mock",
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
      }
    ];
    const mockAi = {
      runAgentCompletion: async () => {
        const next = completions.shift();
        if (!next) throw new Error("no more completions");
        return next;
      },
      cancelTask: () => undefined
    };
    const service = new ChatAgentService(
      files,
      projects,
      new LibraryService(files),
      new StoryStateService(files, projects),
      mockAi as never
    );
    const chapterId = project.outline.volumes[0].chapters[0].id;
    const requestId = "req-approval-test";

    const session = await service.chat(
      {
        requestId,
        projectPath: project.projectPath,
        chapterId,
        message: "看看大纲",
        askBeforeTools: ["get_outline_context"]
      },
      (event) => {
        if (event.type === "tool_approval_requested") {
          const payload = JSON.parse(event.detail) as { callId: string };
          service.approveTool(requestId, payload.callId, false);
        }
      }
    );

    const toolMessage = session.messages.find((message) => message.role === "tool");
    expect(toolMessage?.content).toContain("拒绝");
    expect(session.messages.at(-1)?.content).toContain("直接回答");
  });
});
