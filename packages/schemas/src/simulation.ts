import { z } from "zod";
import type { Character } from "./index.js";

export const SimulationSchemaVersion = "0.1.0";

export const SimulationParticipantSchema = z.object({
  characterId: z.string().min(1),
  goal: z.string().default(""),
  knowledge: z.array(z.string()).default([]),
  hiddenAgenda: z.string().default("")
});

export const SimulationScenarioSchema = z.object({
  schemaVersion: z.literal(SimulationSchemaVersion).default(SimulationSchemaVersion),
  id: z.string().min(1),
  title: z.string().min(1),
  chapterId: z.string().optional(),
  location: z.string().default(""),
  premise: z.string().default(""),
  initialTension: z.number().int().min(0).max(100).default(50),
  taboos: z.array(z.string()).default([]),
  participants: z.array(SimulationParticipantSchema).default([]),
  maxTurns: z.number().int().min(1).max(12).default(6),
  branchCount: z.number().int().min(1).max(3).default(2),
  createdAt: z.string().default(""),
  updatedAt: z.string().default("")
});

export const SimulationTurnSchema = z.object({
  id: z.string().min(1),
  turn: z.number().int().nonnegative(),
  actorId: z.string().min(1),
  actorName: z.string().default(""),
  intent: z.string().default(""),
  action: z.string().default(""),
  dialogue: z.string().default("")
});

export const SimulationBranchSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  premiseShift: z.string().default(""),
  turns: z.array(SimulationTurnSchema).default([]),
  outcome: z.string().default("")
});

export const SimulationUsageSchema = z.object({
  promptTokens: z.number().int().nonnegative().default(0),
  completionTokens: z.number().int().nonnegative().default(0),
  totalTokens: z.number().int().nonnegative().default(0)
});

export const SimulationRunSchema = z.object({
  schemaVersion: z.literal(SimulationSchemaVersion).default(SimulationSchemaVersion),
  id: z.string().min(1),
  scenarioId: z.string().min(1),
  status: z.enum(["running", "completed", "failed", "cancelled"]).default("running"),
  branches: z.array(SimulationBranchSchema).default([]),
  model: z.string().default(""),
  usage: SimulationUsageSchema.default({ promptTokens: 0, completionTokens: 0, totalTokens: 0 }),
  error: z.string().default(""),
  createdAt: z.string(),
  completedAt: z.string().optional()
});

export const SimulationDocumentSchema = z.object({
  schemaVersion: z.literal(SimulationSchemaVersion).default(SimulationSchemaVersion),
  scenario: SimulationScenarioSchema,
  runs: z.array(SimulationRunSchema).default([])
});

export type SimulationParticipant = z.infer<typeof SimulationParticipantSchema>;
export type SimulationScenario = z.infer<typeof SimulationScenarioSchema>;
export type SimulationTurn = z.infer<typeof SimulationTurnSchema>;
export type SimulationBranch = z.infer<typeof SimulationBranchSchema>;
export type SimulationUsage = z.infer<typeof SimulationUsageSchema>;
export type SimulationRun = z.infer<typeof SimulationRunSchema>;
export type SimulationDocument = z.infer<typeof SimulationDocumentSchema>;

const listSection = (label: string, items: string[]): string[] =>
  items.length ? [`${label}：`, ...items.map((item) => `- ${item}`)] : [];

export const buildActorSystemPrompt = (
  character: Character,
  participant: SimulationParticipant,
  scenario: SimulationScenario
): string => {
  const parsed = character;
  const lines: string[] = [
    `你是小说角色「${parsed.name}」。你只以这个角色的身份思考和行动，绝不替其他角色说话或行动。`,
    "",
    "【角色档案】",
    `身份：${parsed.profile.identity || "未设定"}`,
    `动机：${parsed.profile.motivation || "未设定"}`,
    `性格：${parsed.profile.personality || "未设定"}`
  ];
  if (parsed.voiceNotes.trim()) {
    lines.push(`语言风格：${parsed.voiceNotes.trim()}`);
  }
  lines.push(
    "",
    "【当前状态】",
    `所处弧线：${parsed.currentState.arc || "未设定"}`,
    `当前位置：${parsed.currentState.location || "未设定"}`
  );
  lines.push(...listSection("关系", parsed.currentState.relationships));
  lines.push(...listSection("秘密（他人不知）", parsed.currentState.secrets));
  lines.push("", "【本场推演】", `场景：${scenario.location || "未设定"}`, `初始情形：${scenario.premise || "未设定"}`);
  if (participant.goal.trim()) {
    lines.push(`你本场的目标：${participant.goal.trim()}`);
  }
  lines.push(...listSection("你已掌握的信息", participant.knowledge));
  if (participant.hiddenAgenda.trim()) {
    lines.push(`你的隐藏动机：${participant.hiddenAgenda.trim()}`);
  }
  lines.push(...listSection("推演禁忌（任何情况下都不能发生）", scenario.taboos));
  lines.push(
    "",
    "每轮你只输出一个 JSON 对象，不要输出其它内容：",
    '{"intent": "内心意图（一句话）", "action": "外在行动（不超过三句）", "dialogue": "台词（可为空字符串）"}'
  );
  return lines.join("\n");
};

export const buildBranchPremisePrompt = (scenario: SimulationScenario, characters: Character[]): string => {
  const names = scenario.participants
    .map((participant) => characters.find((item) => item.id === participant.characterId)?.name)
    .filter((name): name is string => Boolean(name));
  return [
    `场景「${scenario.title}」：${scenario.premise || "（未填写初始情形）"}`,
    `地点：${scenario.location || "未设定"}；参与角色：${names.join("、") || "未设定"}；初始张力：${scenario.initialTension}/100。`,
    ...listSection("禁忌", scenario.taboos),
    "",
    `请为这场戏提出 ${scenario.branchCount} 个彼此明显不同的走向假设（每个一句话，描述这条分叉里局势朝哪个方向偏转）。`,
    '只输出 JSON 数组，例如：["走向假设一", "走向假设二"]'
  ].join("\n");
};

export const buildTurnUserPrompt = (
  branch: SimulationBranch,
  turnNumber: number,
  maxTurns: number,
  isFinalTurn: boolean
): string => {
  const transcript = branch.turns.length
    ? branch.turns
        .map((turn) => {
          const parts = [`【第${turn.turn}轮·${turn.actorName || turn.actorId}】行动：${turn.action}`];
          if (turn.dialogue.trim()) {
            parts.push(`台词：${turn.dialogue}`);
          }
          return parts.join(" ");
        })
        .join("\n")
    : "（这是第一轮，还没有人行动。）";
  const lines = [
    `本分叉的走向假设：${branch.premiseShift || "顺其自然"}`,
    "",
    "目前为止的推演记录：",
    transcript,
    "",
    `现在是第 ${turnNumber}/${maxTurns} 轮，轮到你行动。`
  ];
  if (isFinalTurn) {
    lines.push(
      "这是最后一轮。除了常规字段外，请在 JSON 中额外加入 outcome 字段，用两三句话总结这条走向的结局与代价：",
      '{"intent": "...", "action": "...", "dialogue": "...", "outcome": "..."}'
    );
  }
  return lines.join("\n");
};

export interface ParsedSimulationTurn {
  intent: string;
  action: string;
  dialogue: string;
  outcome?: string;
}

const extractJsonBlock = (text: string, open: string, close: string): string | undefined => {
  const start = text.indexOf(open);
  if (start < 0) {
    return undefined;
  }
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (char === "\\") {
        i += 1;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === open) {
      depth += 1;
    } else if (char === close) {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return undefined;
};

export const parseSimulationTurn = (text: string): ParsedSimulationTurn => {
  const fallback: ParsedSimulationTurn = { intent: "", action: text.trim(), dialogue: "" };
  const block = extractJsonBlock(text, "{", "}");
  if (!block) {
    return fallback;
  }
  try {
    const raw = JSON.parse(block) as Record<string, unknown>;
    const field = (key: string): string => (typeof raw[key] === "string" ? (raw[key] as string).trim() : "");
    const parsed: ParsedSimulationTurn = {
      intent: field("intent"),
      action: field("action"),
      dialogue: field("dialogue")
    };
    const outcome = field("outcome");
    if (outcome) {
      parsed.outcome = outcome;
    }
    if (!parsed.intent && !parsed.action && !parsed.dialogue) {
      return fallback;
    }
    return parsed;
  } catch {
    return fallback;
  }
};

export const parseBranchPremises = (text: string, expected: number): string[] => {
  const block = extractJsonBlock(text, "[", "]");
  if (block) {
    try {
      const raw = JSON.parse(block) as unknown;
      if (Array.isArray(raw)) {
        const premises = raw
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean);
        if (premises.length) {
          return premises.slice(0, expected);
        }
      }
    } catch {
      // fall through to line splitting
    }
  }
  return text
    .split(/\r?\n/u)
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)、])\s*/u, "").trim())
    .filter(Boolean)
    .slice(0, expected);
};

const branchSignature = (branch: SimulationBranch): string =>
  [branch.outcome, ...branch.turns.map((turn) => turn.action)]
    .join("|")
    .toLowerCase()
    .replace(/[\s\p{P}]+/gu, "");

const charBigrams = (value: string): Set<string> => {
  const grams = new Set<string>();
  for (let i = 0; i < value.length - 1; i += 1) {
    grams.add(value.slice(i, i + 2));
  }
  return grams;
};

export const branchSimilarity = (a: SimulationBranch, b: SimulationBranch): number => {
  const left = branchSignature(a);
  const right = branchSignature(b);
  if (!left.length || !right.length) {
    return left === right ? 1 : 0;
  }
  if (left === right) {
    return 1;
  }
  const leftGrams = charBigrams(left);
  const rightGrams = charBigrams(right);
  if (!leftGrams.size || !rightGrams.size) {
    return 0;
  }
  let shared = 0;
  for (const gram of leftGrams) {
    if (rightGrams.has(gram)) {
      shared += 1;
    }
  }
  return (2 * shared) / (leftGrams.size + rightGrams.size);
};

export const SIMULATION_BRANCH_DEDUPE_THRESHOLD = 0.85;

export const dedupeSimulationBranches = (
  branches: SimulationBranch[],
  threshold = SIMULATION_BRANCH_DEDUPE_THRESHOLD
): SimulationBranch[] => {
  const kept: SimulationBranch[] = [];
  for (const branch of branches) {
    if (!kept.some((existing) => branchSimilarity(existing, branch) >= threshold)) {
      kept.push(branch);
    }
  }
  return kept;
};
