import path from "node:path";
import { readdir } from "node:fs/promises";
import {
  buildActorSystemPrompt,
  buildBranchPremisePrompt,
  buildTurnUserPrompt,
  dedupeSimulationBranches,
  parseBranchPremises,
  parseSimulationTurn,
  SimulationDocumentSchema,
  SimulationScenarioSchema,
  type SimulationBranch,
  type SimulationDocument,
  type SimulationRun,
  type SimulationScenario,
  type SimulationTurn
} from "@inkforge/schemas";
import type { SimulationRunEvent, SimulationRunInput } from "../types.js";
import { AiProviderService } from "./AiProviderService.js";
import { FileRepository } from "./FileRepository.js";
import { LibraryService } from "./LibraryService.js";

const maxStoredRuns = 10;
const defaultTokenLimit = 64_000;

type SimulationEventHandler = (event: SimulationRunEvent) => void;

export class SimulationService {
  private readonly cancelledRequests = new Set<string>();

  constructor(
    private readonly files = new FileRepository(),
    private readonly library = new LibraryService(files),
    private readonly ai = new AiProviderService()
  ) {}

  async list(projectPath: string): Promise<SimulationDocument[]> {
    const dir = this.files.assertInsideProject(projectPath, path.posix.join(".inkforge", "simulations"));
    await this.files.ensureDir(dir);
    const names = await readdir(dir);
    const documents: SimulationDocument[] = [];
    for (const name of names.filter((item) => item.endsWith(".json"))) {
      try {
        documents.push(SimulationDocumentSchema.parse(await this.files.readJson(path.join(dir, name))));
      } catch (error) {
        console.warn(`Skipping invalid simulation document ${name}:`, error);
      }
    }
    return documents.sort((a, b) => b.scenario.updatedAt.localeCompare(a.scenario.updatedAt));
  }

  async saveScenario(projectPath: string, scenario: SimulationScenario): Promise<SimulationDocument> {
    const parsed = SimulationScenarioSchema.parse({
      ...scenario,
      createdAt: scenario.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    const existing = await this.read(projectPath, parsed.id);
    const document = SimulationDocumentSchema.parse({
      scenario: parsed,
      runs: existing?.runs ?? []
    });
    await this.write(projectPath, document);
    return document;
  }

  cancel(requestId: string): void {
    this.cancelledRequests.add(requestId);
    this.ai.cancelTask(requestId);
  }

  async run(input: SimulationRunInput, onEvent?: SimulationEventHandler): Promise<SimulationDocument> {
    const document = await this.read(input.projectPath, input.scenarioId);
    if (!document) {
      throw new Error("找不到这个推演场景。");
    }
    const scenario = document.scenario;
    if (!scenario.participants.length) {
      throw new Error("场景还没有参与角色。");
    }
    const characters = await this.library.listCharacters(input.projectPath);
    const cast = scenario.participants.map((participant) => {
      const character = characters.find((item) => item.id === participant.characterId);
      if (!character) {
        throw new Error(`角色 ${participant.characterId} 不在人物库中。`);
      }
      return { participant, character };
    });

    const requestId = input.requestId;
    if (requestId) {
      this.cancelledRequests.delete(requestId);
    }
    let eventCount = 0;
    const emit = (event: Omit<SimulationRunEvent, "id" | "timestamp">) => {
      eventCount += 1;
      onEvent?.({ id: `sim_event_${eventCount}`, timestamp: new Date().toISOString(), ...event });
    };

    const run: SimulationRun = {
      schemaVersion: "0.1.0",
      id: `run_${Date.now()}`,
      scenarioId: scenario.id,
      status: "running",
      branches: [],
      model: "",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      error: "",
      createdAt: new Date().toISOString()
    };

    const addUsage = (usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }) => {
      run.usage.promptTokens += usage?.prompt_tokens ?? 0;
      run.usage.completionTokens += usage?.completion_tokens ?? 0;
      run.usage.totalTokens += usage?.total_tokens ?? 0;
    };

    try {
      emit({ type: "run_started", label: "推演开始", detail: scenario.title });
      this.assertNotCancelled(requestId);

      const premiseCompletion = await this.ai.runAgentCompletion({
        providerRole: "planner",
        requestId,
        toolChoice: "none",
        messages: [
          { role: "system", content: "你是小说叙事推演引擎的导演。只输出要求的 JSON，不输出其他内容。" },
          {
            role: "user",
            content: buildBranchPremisePrompt(
              scenario,
              cast.map(({ character }) => character)
            )
          }
        ]
      });
      run.model = premiseCompletion.model;
      addUsage(premiseCompletion.usage);
      const premises = parseBranchPremises(premiseCompletion.message.content ?? "", scenario.branchCount);
      while (premises.length < scenario.branchCount) {
        premises.push(`顺其自然的走向 ${premises.length + 1}`);
      }

      for (const [branchIndex, premiseShift] of premises.entries()) {
        this.assertNotCancelled(requestId);
        const branch: SimulationBranch = {
          id: `branch_${branchIndex + 1}`,
          label: `走向 ${String.fromCharCode(65 + branchIndex)}`,
          premiseShift,
          turns: [],
          outcome: ""
        };
        emit({ type: "branch_started", label: `${branch.label} 开始`, detail: premiseShift });

        for (let turnNumber = 1; turnNumber <= scenario.maxTurns; turnNumber += 1) {
          this.assertNotCancelled(requestId);
          if (run.usage.totalTokens >= defaultTokenLimit) {
            emit({ type: "turn_completed", label: "已达 token 预算", detail: "提前收束本次推演。" });
            break;
          }
          const { participant, character } = cast[(turnNumber - 1) % cast.length];
          const isFinalTurn = turnNumber === scenario.maxTurns;
          const completion = await this.ai.runAgentCompletion({
            providerRole: "planner",
            requestId,
            toolChoice: "none",
            messages: [
              { role: "system", content: buildActorSystemPrompt(character, participant, scenario) },
              { role: "user", content: buildTurnUserPrompt(branch, turnNumber, scenario.maxTurns, isFinalTurn) }
            ]
          });
          addUsage(completion.usage);
          const parsed = parseSimulationTurn(completion.message.content ?? "");
          const turn: SimulationTurn = {
            id: `${branch.id}_turn_${turnNumber}`,
            turn: turnNumber,
            actorId: character.id,
            actorName: character.name,
            intent: parsed.intent,
            action: parsed.action,
            dialogue: parsed.dialogue
          };
          branch.turns.push(turn);
          if (parsed.outcome) {
            branch.outcome = parsed.outcome;
          }
          emit({
            type: "turn_completed",
            label: `${branch.label} · 第 ${turnNumber} 轮 · ${character.name}`,
            detail: parsed.action
          });
        }

        if (!branch.outcome) {
          branch.outcome = branch.turns.at(-1)?.action ?? "（推演没有产生结局。）";
        }
        run.branches.push(branch);
        emit({ type: "branch_completed", label: `${branch.label} 完成`, detail: branch.outcome });
      }

      run.branches = dedupeSimulationBranches(run.branches);
      run.status = "completed";
      run.completedAt = new Date().toISOString();
      emit({ type: "run_completed", label: "推演完成", detail: `共 ${run.branches.length} 条走向` });
    } catch (error) {
      const cancelled = requestId ? this.cancelledRequests.has(requestId) : false;
      run.status = cancelled ? "cancelled" : "failed";
      run.error = cancelled ? "" : error instanceof Error ? error.message : String(error);
      run.completedAt = new Date().toISOString();
      emit({
        type: cancelled ? "run_cancelled" : "run_failed",
        label: cancelled ? "推演已取消" : "推演失败",
        detail: run.error
      });
    } finally {
      if (requestId) {
        this.cancelledRequests.delete(requestId);
      }
    }

    const latestDocument = await this.read(input.projectPath, input.scenarioId);
    const next = SimulationDocumentSchema.parse({
      scenario: latestDocument?.scenario ?? scenario,
      runs: [run, ...(latestDocument?.runs ?? document.runs).filter((storedRun) => storedRun.id !== run.id)].slice(
        0,
        maxStoredRuns
      )
    });
    await this.write(input.projectPath, next);
    return next;
  }

  private assertNotCancelled(requestId?: string): void {
    if (requestId && this.cancelledRequests.has(requestId)) {
      const error = new Error("推演已被取消。");
      error.name = "AbortError";
      throw error;
    }
  }

  private async read(projectPath: string, scenarioId: string): Promise<SimulationDocument | undefined> {
    try {
      const raw = await this.files.readJson<unknown>(this.documentPath(projectPath, scenarioId));
      return SimulationDocumentSchema.parse(raw);
    } catch (error) {
      if (isMissingFile(error)) {
        return undefined;
      }
      throw error;
    }
  }

  private async write(projectPath: string, document: SimulationDocument): Promise<void> {
    await this.files.writeJsonAtomic(this.documentPath(projectPath, document.scenario.id), document);
  }

  private documentPath(projectPath: string, scenarioId: string): string {
    return this.files.assertInsideProject(
      projectPath,
      path.posix.join(".inkforge", "simulations", `${safeId(scenarioId)}.json`)
    );
  }
}

const safeId = (value: string): string => value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "scenario";

const isMissingFile = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT";
