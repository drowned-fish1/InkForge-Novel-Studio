import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { CharacterSchema } from "../src/index";
import {
  buildActorSystemPrompt,
  buildBranchPremisePrompt,
  buildTurnUserPrompt,
  branchSimilarity,
  dedupeSimulationBranches,
  parseBranchPremises,
  parseSimulationTurn,
  SimulationDocumentSchema,
  SimulationScenarioSchema,
  type SimulationBranch
} from "../src/simulation";

const character = CharacterSchema.parse({
  id: "lin",
  name: "林烬",
  profile: { identity: "夜班检票员", motivation: "找到父亲失踪的真相", personality: "克制、多疑" },
  currentState: {
    arc: "从旁观到卷入",
    location: "老车站",
    relationships: ["与站长互相提防"],
    secrets: ["保留着父亲的旧车票"]
  },
  voiceNotes: "短句，不解释自己"
});

const scenario = SimulationScenarioSchema.parse({
  id: "scene-1",
  title: "深夜对峙",
  location: "车站储物间",
  premise: "站长深夜出现在储物间，林烬撞见。",
  taboos: ["不揭开父亲失踪的最终答案"],
  participants: [
    {
      characterId: "lin",
      goal: "弄清站长深夜来做什么",
      knowledge: ["储物柜编号 217 属于父亲"],
      hiddenAgenda: "不暴露自己持有旧车票"
    }
  ]
});

const branch = (id: string, actions: string[], outcome = ""): SimulationBranch => ({
  id,
  label: `走向 ${id}`,
  premiseShift: "",
  turns: actions.map((action, index) => ({
    id: `${id}-t${index}`,
    turn: index + 1,
    actorId: "lin",
    actorName: "林烬",
    intent: "",
    action,
    dialogue: ""
  })),
  outcome
});

describe("simulation schemas", () => {
  it("applies scenario defaults", () => {
    expect(scenario.maxTurns).toBe(6);
    expect(scenario.branchCount).toBe(2);
    expect(scenario.initialTension).toBe(50);
  });

  it("rejects an out-of-range turn limit", () => {
    expect(() => SimulationScenarioSchema.parse({ id: "x", title: "越界", maxTurns: 99 })).toThrow(ZodError);
  });

  it("parses a full simulation document", () => {
    const document = SimulationDocumentSchema.parse({ scenario });
    expect(document.runs).toEqual([]);
    expect(document.scenario.id).toBe("scene-1");
  });
});

describe("buildActorSystemPrompt", () => {
  it("weaves character card and scenario overrides together", () => {
    const prompt = buildActorSystemPrompt(character, scenario.participants[0], scenario);
    expect(prompt).toContain("林烬");
    expect(prompt).toContain("夜班检票员");
    expect(prompt).toContain("你本场的目标：弄清站长深夜来做什么");
    expect(prompt).toContain("储物柜编号 217 属于父亲");
    expect(prompt).toContain("不暴露自己持有旧车票");
    expect(prompt).toContain("不揭开父亲失踪的最终答案");
    expect(prompt).toContain('{"intent"');
  });

  it("marks unset profile fields instead of leaving blanks", () => {
    const minimal = CharacterSchema.parse({ id: "x", name: "无名" });
    const prompt = buildActorSystemPrompt(
      minimal,
      { characterId: "x", goal: "", knowledge: [], hiddenAgenda: "" },
      scenario
    );
    expect(prompt).toContain("身份：未设定");
    expect(prompt).not.toContain("你本场的目标");
  });
});

describe("buildBranchPremisePrompt / buildTurnUserPrompt", () => {
  it("asks for the configured number of branch premises", () => {
    const prompt = buildBranchPremisePrompt(scenario, [character]);
    expect(prompt).toContain("2 个彼此明显不同的走向假设");
    expect(prompt).toContain("林烬");
  });

  it("includes the transcript and final-turn outcome request", () => {
    const withTurns = branch("a", ["他关上了灯。"]);
    const prompt = buildTurnUserPrompt(withTurns, 2, 6, true);
    expect(prompt).toContain("他关上了灯。");
    expect(prompt).toContain("第 2/6 轮");
    expect(prompt).toContain("outcome");
  });

  it("notes an empty transcript on the first turn", () => {
    const prompt = buildTurnUserPrompt(branch("a", []), 1, 6, false);
    expect(prompt).toContain("第一轮");
    expect(prompt).not.toContain("outcome");
  });
});

describe("parseSimulationTurn", () => {
  it("parses a fenced JSON turn", () => {
    const parsed = parseSimulationTurn(
      '```json\n{"intent": "试探", "action": "他敲了敲柜门。", "dialogue": "谁在里面？"}\n```'
    );
    expect(parsed).toEqual({ intent: "试探", action: "他敲了敲柜门。", dialogue: "谁在里面？" });
  });

  it("captures the optional outcome field", () => {
    const parsed = parseSimulationTurn(
      '{"intent": "收尾", "action": "他退后一步。", "dialogue": "", "outcome": "对峙以沉默收场。"}'
    );
    expect(parsed.outcome).toBe("对峙以沉默收场。");
  });

  it("falls back to raw text when no JSON is present", () => {
    const parsed = parseSimulationTurn("他沉默地退出了储物间。");
    expect(parsed).toEqual({ intent: "", action: "他沉默地退出了储物间。", dialogue: "" });
  });

  it("ignores braces inside strings while matching the block", () => {
    const parsed = parseSimulationTurn('前言 {"intent": "藏起 } 符号", "action": "行动", "dialogue": ""} 后记');
    expect(parsed.intent).toBe("藏起 } 符号");
  });
});

describe("parseBranchPremises", () => {
  it("parses a JSON array", () => {
    expect(parseBranchPremises('["冲突公开化", "站长先让步"]', 2)).toEqual(["冲突公开化", "站长先让步"]);
  });

  it("truncates to the expected count", () => {
    expect(parseBranchPremises('["一", "二", "三"]', 2)).toEqual(["一", "二"]);
  });

  it("falls back to list lines", () => {
    expect(parseBranchPremises("1. 冲突公开化\n2. 站长先让步", 2)).toEqual(["冲突公开化", "站长先让步"]);
  });
});

describe("branch dedupe", () => {
  it("treats identical transcripts as duplicates", () => {
    const a = branch("a", ["他关灯。", "他开门。"], "不欢而散");
    const b = branch("b", ["他关灯。", "他开门。"], "不欢而散");
    expect(branchSimilarity(a, b)).toBe(1);
    expect(dedupeSimulationBranches([a, b])).toHaveLength(1);
  });

  it("keeps genuinely different branches", () => {
    const a = branch("a", ["他关灯，装作没看见。"], "秘密保住了");
    const b = branch("b", ["他当面摊牌，要求打开储物柜。"], "冲突公开化");
    expect(branchSimilarity(a, b)).toBeLessThan(0.85);
    expect(dedupeSimulationBranches([a, b])).toHaveLength(2);
  });

  it("keeps the first occurrence when deduping", () => {
    const a = branch("a", ["他关灯。"], "沉默");
    const b = branch("b", ["他关灯。"], "沉默");
    expect(dedupeSimulationBranches([a, b])[0].id).toBe("a");
  });
});
