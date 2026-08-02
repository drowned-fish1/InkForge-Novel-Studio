import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ChapterContractSchema, EvidencePackSchema, type EvidencePack, type StoryBranch } from "@inkforge/schemas";
import { describe, expect, it, vi } from "vitest";
import type { AgentCompletionResult } from "./AiProviderService.js";
import { ContinuationOrchestrator, type ContinuationProvider } from "./ContinuationOrchestrator.js";
import { FileRepository } from "./FileRepository.js";
import { ProjectService } from "./ProjectService.js";

const makePack = (chapterId: string, contract = ChapterContractSchema.parse({ chapterId })): EvidencePack =>
  EvidencePackSchema.parse({
    chapterContract: contract,
    hardConstraints: [],
    immediateContinuity: [],
    activeCharacterStates: [],
    dueThreads: [],
    retrievedEvidence: [],
    styleExemplars: [],
    exclusions: [],
    tokenUsageBySection: {},
    omittedSections: [],
    generatedAt: new Date().toISOString(),
    query: "test"
  });

const setup = async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "inkforge-continuation-"));
  const project = await new ProjectService().createProject(parent, {
    title: "Continuation Test",
    author: "tester",
    genre: ["fantasy"],
    targetWords: 10_000,
    style: "",
    protagonist: "主角",
    premise: "测试前提"
  });
  const files = new FileRepository();
  const chapter = project.outline.volumes[0].chapters[0];
  await files.writeTextAtomic(files.assertInsideProject(project.projectPath, chapter.file), "上一段正文。");
  return { parent, projectPath: project.projectPath, chapterId: chapter.id, files };
};

const makeProvider = (draft = "银灯在门后亮起。") => {
  const completion: AgentCompletionResult = {
    message: { role: "assistant", content: draft },
    model: "mock-model",
    usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 }
  };
  return {
    runAgentCompletion: vi.fn(async () => completion),
    cancelTask: vi.fn()
  } satisfies ContinuationProvider;
};

describe("ContinuationOrchestrator", () => {
  it("compiles evidence, generates prose, and leaves the source chapter untouched", async () => {
    const fixture = await setup();
    try {
      const contract = ChapterContractSchema.parse({ chapterId: fixture.chapterId, mustHappen: ["银灯"] });
      const provider = makeProvider();
      const branchCreate = vi.fn(async (input: { content?: string }) => ({
        id: "branch-success",
        content: input.content ?? ""
      })) as never;
      const pack = makePack(fixture.chapterId, contract);
      const compiler = { compile: vi.fn(async () => pack) } as never;
      const service = new ContinuationOrchestrator({
        files: fixture.files,
        provider,
        compiler,
        branches: { create: branchCreate },
        styles: { load: async () => undefined, evaluateText: async () => ({ score: 100, warnings: [], deltas: [] }) }
      });

      const result = await service.run({
        projectPath: fixture.projectPath,
        chapterId: fixture.chapterId,
        contract,
        instruction: "继续开门"
      });

      expect(result.status).toBe("completed");
      expect(result.branchId).toBe("branch-success");
      expect(result.evidencePack).toEqual(pack);
      expect(result.validation?.canApply).toBe(true);
      expect(result.usage?.totalTokens).toBe(18);
      expect(provider.runAgentCompletion).toHaveBeenCalledOnce();
      const messages = provider.runAgentCompletion.mock.calls[0]?.[0].messages ?? [];
      expect(messages[0]?.content).toContain("Hard canon constraints");
      expect(messages[1]?.content).toContain("Evidence pack");
      expect(messages[1]?.content).toContain("银灯");
      expect(branchCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          source: "agent",
          content: "上一段正文。\n\n银灯在门后亮起。\n"
        })
      );
      expect(
        await fixture.files.readText(
          fixture.files.assertInsideProject(fixture.projectPath, "chapters/volume-001/ch-0001.md")
        )
      ).toBe("上一段正文。");
    } finally {
      await rm(fixture.parent, { recursive: true, force: true });
    }
  });

  it("marks hard validation failures blocked while retaining the generated branch", async () => {
    const fixture = await setup();
    try {
      const contract = ChapterContractSchema.parse({ chapterId: fixture.chapterId, mustHappen: ["必须出现"] });
      const provider = makeProvider("不满足要求的草稿。");
      const pack = makePack(fixture.chapterId, contract);
      const branch = { id: "branch-blocked", content: "上一段正文。\n\n不满足要求的草稿。\n" } as StoryBranch;
      const validator = {
        validate: vi.fn(() => ({
          canApply: false,
          hardFailures: 1,
          softWarnings: 0,
          findings: [
            {
              id: "hard-1",
              severity: "hard" as const,
              category: "contract" as const,
              title: "缺少硬要求",
              detail: "必须出现"
            }
          ]
        }))
      } as never;
      const service = new ContinuationOrchestrator({
        files: fixture.files,
        provider,
        compiler: { compile: async () => pack } as never,
        validator,
        branches: { create: async () => branch },
        styles: { load: async () => undefined, evaluateText: async () => ({ score: 90, warnings: [], deltas: [] }) }
      });

      const result = await service.run({ projectPath: fixture.projectPath, chapterId: fixture.chapterId, contract });

      expect(result.status).toBe("blocked");
      expect(result.checkpoint.phase).toBe("blocked");
      expect(result.branchId).toBe("branch-blocked");
      expect(result.validation?.hardFailures).toBe(1);
      const stored = await service.get(fixture.projectPath, result.id);
      expect(stored?.status).toBe("blocked");
    } finally {
      await rm(fixture.parent, { recursive: true, force: true });
    }
  });

  it("persists provider failures and allows a retry", async () => {
    const fixture = await setup();
    try {
      let shouldFail = true;
      const provider = {
        ...makeProvider("重试后成功"),
        runAgentCompletion: vi.fn(async () => {
          if (shouldFail) throw new Error("provider unavailable");
          return {
            message: { role: "assistant" as const, content: "重试后成功" },
            model: "mock-model",
            usage: { total_tokens: 4 }
          };
        })
      } satisfies ContinuationProvider;
      const contract = ChapterContractSchema.parse({ chapterId: fixture.chapterId });
      const pack = makePack(fixture.chapterId, contract);
      const branches = { create: async () => ({ id: "branch-retry" }) } as never;
      const service = new ContinuationOrchestrator({
        files: fixture.files,
        provider,
        compiler: { compile: async () => pack } as never,
        branches,
        styles: { load: async () => undefined, evaluateText: async () => ({ score: 100, warnings: [], deltas: [] }) }
      });

      const failed = await service.run({ projectPath: fixture.projectPath, chapterId: fixture.chapterId, contract });
      expect(failed.status).toBe("failed");
      expect(failed.error).toBe("provider unavailable");
      const restarted = new ContinuationOrchestrator({ files: fixture.files });
      expect((await restarted.get(fixture.projectPath, failed.id))?.status).toBe("failed");

      shouldFail = false;
      const retried = await service.retry(fixture.projectPath, failed.id);
      expect(retried.status).toBe("completed");
      expect(retried.branchId).toBe("branch-retry");
    } finally {
      await rm(fixture.parent, { recursive: true, force: true });
    }
  });

  it("cancels a provider request and records the cancelled checkpoint", async () => {
    const fixture = await setup();
    try {
      const contract = ChapterContractSchema.parse({ chapterId: fixture.chapterId });
      const pack = makePack(fixture.chapterId, contract);
      let release: (() => void) | undefined;
      let started: (() => void) | undefined;
      const provider = {
        cancelTask: vi.fn(),
        runAgentCompletion: vi.fn(
          () =>
            new Promise<AgentCompletionResult>((resolve) => {
              started?.();
              release = () => resolve({ message: { role: "assistant", content: "迟到的草稿" }, model: "mock" });
            })
        )
      } satisfies ContinuationProvider;
      const startedPromise = new Promise<void>((resolve) => {
        started = resolve;
      });
      const service = new ContinuationOrchestrator({
        files: fixture.files,
        provider,
        compiler: { compile: async () => pack } as never,
        branches: { create: async () => ({ id: "never" }) } as never,
        styles: { load: async () => undefined, evaluateText: async () => ({ score: 100, warnings: [], deltas: [] }) }
      });
      const running = service.run({ projectPath: fixture.projectPath, chapterId: fixture.chapterId, contract });
      await startedPromise;
      const [run] = await service.list(fixture.projectPath);
      await service.cancel(fixture.projectPath, run!.id);
      release?.();
      const result = await running;
      expect(result.status).toBe("cancelled");
      expect(result.checkpoint.phase).toBe("cancelled");
      expect(provider.cancelTask).toHaveBeenCalledOnce();
    } finally {
      await rm(fixture.parent, { recursive: true, force: true });
    }
  });
});
