import type { SelfReviewResult } from "./review.js";
import type { WritingSessionState, WritingSessionStatus } from "./session.js";

export type DecisionType = "branch-choice" | "character-action" | "canon-conflict" | "clue-timing" | "quality-warning";

export interface DecisionContext {
  text?: string;
  choices?: string[];
  review?: SelfReviewResult;
}

export interface DecisionCandidate {
  id: string;
  type: DecisionType;
  confidence: number;
  reason: string;
  choices?: string[];
}

export interface DecisionApplication {
  decisionId: string;
  selectedChoice?: string;
  note?: string;
  nextStatus?: WritingSessionStatus;
}

const contains = (text: string, patterns: RegExp[]): boolean => patterns.some((pattern) => pattern.test(text));

export class DecisionAnalyzer {
  detect(context: DecisionContext): DecisionCandidate[] {
    const text = context.text ?? "";
    const decisions: DecisionCandidate[] = [];

    if ((context.choices?.length ?? 0) > 1 || contains(text, [/分支|路线|选项|branch|choose/i])) {
      decisions.push({
        id: "decision_branch_choice",
        type: "branch-choice",
        confidence: context.choices?.length ? 0.95 : 0.7,
        reason: "Detected multiple plot branches or explicit choice language.",
        choices: context.choices
      });
    }

    if (contains(text, [/人物.*(行动|选择|反应)|角色.*(行动|选择|反应)|character.*(act|choice|react)/i])) {
      decisions.push({
        id: "decision_character_action",
        type: "character-action",
        confidence: 0.75,
        reason: "Detected uncertainty about a character action."
      });
    }

    if (contains(text, [/冲突|矛盾|设定.*不一致|canon|conflict|contradict/i])) {
      decisions.push({
        id: "decision_canon_conflict",
        type: "canon-conflict",
        confidence: 0.85,
        reason: "Detected potential canon or setting conflict."
      });
    }

    if (contains(text, [/伏笔|埋线|回收|payoff|foreshadow|clue/i])) {
      decisions.push({
        id: "decision_clue_timing",
        type: "clue-timing",
        confidence: 0.8,
        reason: "Detected foreshadowing timing or payoff question."
      });
    }

    if ((context.review && !context.review.passed) || contains(text, [/质量|节奏|声音|术语|warning|score/i])) {
      decisions.push({
        id: "decision_quality_warning",
        type: "quality-warning",
        confidence: context.review && !context.review.passed ? 0.9 : 0.65,
        reason: "Detected quality warning or failed self review."
      });
    }

    return decisions;
  }

  applyDecision(state: WritingSessionState, application: DecisionApplication): WritingSessionState {
    return {
      ...structuredClone(state),
      status: application.nextStatus ?? "writing",
      pendingDecision: undefined
    };
  }
}
