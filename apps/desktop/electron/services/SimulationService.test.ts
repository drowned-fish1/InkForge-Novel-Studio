import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CharacterSchema, SimulationScenarioSchema } from "@inkforge/schemas";
import type { SimulationRunEvent } from "../types.js";
import type { AiProviderService, AgentCompletionInput, AgentCompletionResult } from "./AiProviderService.js";
import { FileRepository } from "./FileRepository.js";
import { LibraryService } from "./LibraryService.js";
import { SimulationService } from "./SimulationService.js";

const created: string[] = [];

afterEach(async () => {
  for (const directory of created.splice(0)) {
    if (path.resolve(directory).startsWith(path.resolve(os.tmpdir()))) {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

const scenario = SimulationScenarioSchema.parse({
  id: "scene-1",
  title: "深夜对峙",
  premise: "站长深夜出现在储物间。",
  participants: [{ characterId: "lin", goal: "弄清真相", knowledge: [], hiddenAgenda: "" }],
  maxTurns: 2,
  branchCount: 2
});

class FakeAiProvider {
  readonly calls: AgentCompletionInput[] = [];
  cancelTask(): void {}

  async runAgentCompletion(input: AgentCompletionInput): Promise<AgentCompletionResult> {
    this.calls.push(input);
    const userMessage = String(input.messages.at(-1)?.content ?? "");
    const secondBranch = userMessage.includes("站长先让步");
    let content: string;
    if (userMessage.includes("请为这场戏提出")) {
      content = '["冲突公开化", "站长先让步"]';
    } else if (userMessage.includes("outcome")) {
      content = secondBranch
        ? '{"intent": "退让", "action": "站长交出了钥匙。", "dialogue": "", "outcome": "他拿到了柜门钥匙。"}'
        : '{"intent": "收尾", "action": "他退后一步。", "dialogue": "", "outcome": "对峙以沉默收场。"}';
    } else {
      content = secondBranch
        ? '{"intent": "压制", "action": "他堵住了储物间的门。", "dialogue": "把话说清楚。"}'
        : '{"intent": "试探", "action": "他敲了敲柜门。", "dialogue": "谁在里面？"}';
    }
    return {
      message: { role: "assistant", content },
      model: "fake-model",
      usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 }
    };
  }
}

const setup = async () => {
  const projectPath = await mkdtemp(path.join(os.tmpdir(), "inkforge-simulation-"));
  created.push(projectPath);
  const files = new FileRepository();
  const library = new LibraryService(files);
  await library.saveCharacter(
    projectPath,
    CharacterSchema.parse({ id: "lin", name: "林烬", profile: { identity: "夜班检票员" } })
  );
  const fakeAi = new FakeAiProvider();
  const service = new SimulationService(files, library, fakeAi as unknown as AiProviderService);
  return { projectPath, service, fakeAi };
};

describe("SimulationService", () => {
  it("saves scenarios and lists them back", async () => {
    const { projectPath, service } = await setup();
    await service.saveScenario(projectPath, scenario);
    const documents = await service.list(projectPath);
    expect(documents).toHaveLength(1);
    expect(documents[0].scenario.title).toBe("深夜对峙");
    expect(documents[0].scenario.updatedAt).not.toBe("");
  });

  it("skips a corrupt simulation document while keeping valid scenarios available", async () => {
    const { projectPath, service } = await setup();
    await service.saveScenario(projectPath, scenario);
    const simulationsPath = path.join(projectPath, ".inkforge", "simulations");
    await mkdir(simulationsPath, { recursive: true });
    await writeFile(path.join(simulationsPath, "broken.json"), "{broken", "utf8");

    const documents = await service.list(projectPath);

    expect(documents).toHaveLength(1);
    expect(documents[0].scenario.id).toBe("scene-1");
  });

  it("runs a bounded simulation and persists branch outcomes", async () => {
    const { projectPath, service, fakeAi } = await setup();
    await service.saveScenario(projectPath, scenario);

    const events: SimulationRunEvent[] = [];
    const document = await service.run({ projectPath, scenarioId: "scene-1", requestId: "req-1" }, (event) =>
      events.push(event)
    );

    const run = document.runs[0];
    expect(run.status).toBe("completed");
    expect(run.model).toBe("fake-model");
    expect(run.branches).toHaveLength(2);
    expect(run.branches[0].premiseShift).toBe("冲突公开化");
    expect(run.branches[0].turns).toHaveLength(2);
    expect(run.branches[0].turns[0].actorName).toBe("林烬");
    expect(run.branches[0].outcome).toBe("对峙以沉默收场。");
    // 1 premise call + 2 branches × 2 turns
    expect(fakeAi.calls).toHaveLength(5);
    expect(run.usage.totalTokens).toBe(140 * 5);
    expect(events.at(0)?.type).toBe("run_started");
    expect(events.at(-1)?.type).toBe("run_completed");
  });

  it("records a cancelled run when the request is cancelled mid-flight", async () => {
    const { projectPath, service, fakeAi } = await setup();
    await service.saveScenario(projectPath, scenario);
    const originalRun = fakeAi.runAgentCompletion.bind(fakeAi);
    let callCount = 0;
    fakeAi.runAgentCompletion = async (input) => {
      callCount += 1;
      if (callCount === 2) {
        service.cancel("req-2");
      }
      return originalRun(input);
    };

    const document = await service.run({ projectPath, scenarioId: "scene-1", requestId: "req-2" });
    expect(document.runs[0].status).toBe("cancelled");
    expect(document.runs[0].error).toBe("");
  });

  it("records a failed run when the provider throws", async () => {
    const { projectPath, service, fakeAi } = await setup();
    await service.saveScenario(projectPath, scenario);
    fakeAi.runAgentCompletion = async () => {
      throw new Error("Provider unavailable.");
    };

    const document = await service.run({ projectPath, scenarioId: "scene-1" });
    expect(document.runs[0].status).toBe("failed");
    expect(document.runs[0].error).toBe("Provider unavailable.");
  });

  it("preserves scenario edits saved while a run is in progress", async () => {
    const { projectPath, service, fakeAi } = await setup();
    await service.saveScenario(projectPath, scenario);
    const originalRun = fakeAi.runAgentCompletion.bind(fakeAi);
    let releaseFirstCall: (() => void) | undefined;
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      releaseFirstCall = resolve;
    });
    let first = true;
    fakeAi.runAgentCompletion = async (input) => {
      if (first) {
        first = false;
        markStarted?.();
        await gate;
      }
      return originalRun(input);
    };

    const running = service.run({ projectPath, scenarioId: scenario.id });
    await started;
    await service.saveScenario(projectPath, { ...scenario, premise: "运行期间保存的新前提。" });
    releaseFirstCall?.();
    const document = await running;

    expect(document.scenario.premise).toBe("运行期间保存的新前提。");
  });

  it("rejects a run when a participant is missing from the library", async () => {
    const { projectPath, service } = await setup();
    await service.saveScenario(projectPath, {
      ...scenario,
      participants: [{ characterId: "ghost", goal: "", knowledge: [], hiddenAgenda: "" }]
    });
    await expect(service.run({ projectPath, scenarioId: "scene-1" })).rejects.toThrow("人物库");
  });
});
