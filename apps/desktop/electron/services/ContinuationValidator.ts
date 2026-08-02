import type { CanonFact, ChapterContract, StoryThread, StyleProfile } from "@inkforge/schemas";
import type { StyleEvaluationResult } from "./StyleProfileService.js";

export type ContinuationFindingSeverity = "hard" | "soft";
export type ContinuationFindingCategory = "contract" | "canon" | "thread" | "style" | "length";

export interface ContinuationFinding {
  id: string;
  severity: ContinuationFindingSeverity;
  category: ContinuationFindingCategory;
  title: string;
  detail: string;
  relatedId?: string;
}

export interface ContinuationValidationReport {
  canApply: boolean;
  hardFailures: number;
  softWarnings: number;
  findings: ContinuationFinding[];
  styleScore?: number;
}

export interface ContinuationValidationInput {
  draft: string;
  contract: ChapterContract;
  hardConstraints?: CanonFact[];
  dueThreads?: StoryThread[];
  styleProfile?: StyleProfile;
  styleEvaluation?: StyleEvaluationResult;
}

export class ContinuationValidator {
  validate(input: ContinuationValidationInput): ContinuationValidationReport {
    const findings: ContinuationFinding[] = [];
    const normalized = normalize(input.draft);
    const pushMissing = (value: string, severity: ContinuationFindingSeverity, label: string, relatedId?: string) => {
      if (value.trim() && !normalized.includes(normalize(value))) {
        findings.push({
          id: stableFindingId("missing", label, value),
          severity,
          category: label === "剧情线回收" ? "thread" : "contract",
          title: `缺少${label}`,
          detail: `草稿中没有找到“${value}”。`,
          relatedId
        });
      }
    };
    const pushForbidden = (
      value: string,
      severity: ContinuationFindingSeverity,
      label: string,
      category: ContinuationFindingCategory,
      relatedId?: string
    ) => {
      if (value.trim() && normalized.includes(normalize(value))) {
        findings.push({
          id: stableFindingId("forbidden", label, value),
          severity,
          category,
          title: `出现${label}`,
          detail: `草稿包含被禁止的内容“${value}”。`,
          relatedId
        });
      }
    };

    for (const requirement of [...input.contract.mustHappen, ...input.contract.requiredBeats]) {
      pushMissing(requirement, "hard", "章节硬要求");
    }
    for (const forbidden of [...input.contract.mustNotHappen, ...input.contract.forbiddenBeats]) {
      pushForbidden(forbidden, "hard", "章节禁写项", "contract");
    }

    for (const fact of input.hardConstraints ?? []) {
      if (fact.status !== "author_locked") continue;
      const values = Array.isArray(fact.objectValue) ? fact.objectValue : [String(fact.objectValue)];
      if (["forbidden_phrase", "must_not_contain", "forbidden_term"].includes(fact.predicate)) {
        for (const value of values) pushForbidden(String(value), "hard", "锁定正典禁项", "canon", fact.id);
      }
      if (["required_phrase", "required_term"].includes(fact.predicate)) {
        for (const value of values) pushMissing(String(value), "hard", "锁定正典要求", fact.id);
      }
    }

    const dueThreads = new Map((input.dueThreads ?? []).map((thread) => [thread.id, thread]));
    for (const threadId of input.contract.threadsToPayoff) {
      const thread = dueThreads.get(threadId);
      if (!thread?.expectedPayoff.trim()) continue;
      pushMissing(thread.expectedPayoff, thread.locked ? "hard" : "soft", "剧情线回收", thread.id);
    }

    const styleProfile = input.styleProfile;
    for (const pattern of styleProfile?.forbiddenPatterns ?? []) {
      if (!pattern.trim()) continue;
      if (pattern.startsWith("regex:")) {
        try {
          if (new RegExp(pattern.slice(6), "u").test(input.draft)) {
            findings.push({
              id: stableFindingId("style-regex", pattern),
              severity: styleProfile?.locked ? "hard" : "soft",
              category: "style",
              title: "命中文风禁用模式",
              detail: pattern.slice(6)
            });
          }
        } catch {
          findings.push({
            id: stableFindingId("invalid-regex", pattern),
            severity: "soft",
            category: "style",
            title: "文风禁用规则无效",
            detail: pattern
          });
        }
      } else {
        pushForbidden(pattern, styleProfile?.locked ? "hard" : "soft", "文风禁用表达", "style");
      }
    }

    for (const warning of input.styleEvaluation?.warnings ?? []) {
      findings.push({
        id: stableFindingId("style-drift", warning),
        severity: "soft",
        category: "style",
        title: "文风偏离基线",
        detail: warning
      });
    }

    const targetCharacters = input.contract.targetWords;
    const actualCharacters = visibleLength(input.draft);
    if (targetCharacters && actualCharacters < targetCharacters * 0.6) {
      findings.push({
        id: stableFindingId("too-short", String(targetCharacters), String(actualCharacters)),
        severity: "soft",
        category: "length",
        title: "草稿明显短于章节目标",
        detail: `目标约 ${targetCharacters} 字，当前 ${actualCharacters} 字。`
      });
    }

    const hardFailures = findings.filter((finding) => finding.severity === "hard").length;
    return {
      canApply: hardFailures === 0,
      hardFailures,
      softWarnings: findings.length - hardFailures,
      findings,
      styleScore: input.styleEvaluation?.score
    };
  }
}

const normalize = (value: string): string => value.normalize("NFKC").replace(/\s+/gu, "").toLocaleLowerCase();
const visibleLength = (value: string): number => [...value.replace(/\s/gu, "")].length;
const stableFindingId = (...parts: string[]): string => {
  let hash = 2166136261;
  for (const character of parts.join("\u0000")) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `continuation-${(hash >>> 0).toString(16)}`;
};
