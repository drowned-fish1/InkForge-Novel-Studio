export type ReviewCategory = "scene-goal" | "character-voice" | "terms" | "canon-conflict";

export interface SelfReviewInput {
  sceneGoal: string;
  draft: string;
  contextSummary?: string;
  expectedCharacters?: string[];
  requiredTerms?: string[];
  lockedCanon?: string[];
}

export interface ReviewFinding {
  category: ReviewCategory;
  severity: "info" | "warning" | "error";
  message: string;
}

export interface SelfReviewResult {
  passed: boolean;
  score: number;
  findings: ReviewFinding[];
  categoryScores: Record<ReviewCategory, number>;
  summary: string;
}

export type ReviewHeuristic = (input: SelfReviewInput) => ReviewFinding[];

const categories: ReviewCategory[] = ["scene-goal", "character-voice", "terms", "canon-conflict"];

const includesLoose = (text: string, needle: string): boolean => text.toLowerCase().includes(needle.toLowerCase());

export class SelfReviewer {
  private readonly extraHeuristics: ReviewHeuristic[];

  constructor(extraHeuristics: ReviewHeuristic[] = []) {
    this.extraHeuristics = extraHeuristics;
  }

  review(input: SelfReviewInput): SelfReviewResult {
    const findings = [...this.defaultFindings(input), ...this.extraHeuristics.flatMap((heuristic) => heuristic(input))];
    const categoryScores = this.scoreCategories(findings);
    const score = Math.round(
      categories.reduce((total, category) => total + categoryScores[category], 0) / categories.length
    );

    return {
      passed: score >= 80 && findings.every((finding) => finding.severity === "info"),
      score,
      findings,
      categoryScores,
      summary:
        findings.length === 0
          ? "Self review passed without material issues."
          : findings.map((finding) => finding.message).join("\n")
    };
  }

  private defaultFindings(input: SelfReviewInput): ReviewFinding[] {
    const findings: ReviewFinding[] = [];
    const draft = input.draft.trim();
    if (!draft) {
      return [
        { category: "scene-goal", severity: "error", message: "Draft is empty." },
        {
          category: "character-voice",
          severity: "warning",
          message: "Character voices cannot be checked without prose."
        }
      ];
    }

    const goalKeywords = input.sceneGoal.split(/[^\p{Letter}\p{Number}]+/u).filter((part) => part.length >= 2);
    if (goalKeywords.length > 0 && !goalKeywords.some((keyword) => includesLoose(draft, keyword))) {
      findings.push({
        category: "scene-goal",
        severity: "warning",
        message: "Draft does not visibly address the scene goal."
      });
    }

    for (const character of input.expectedCharacters ?? []) {
      if (!includesLoose(draft, character)) {
        findings.push({
          category: "character-voice",
          severity: "warning",
          message: `Expected character is absent or unnamed: ${character}.`
        });
      }
    }

    for (const term of input.requiredTerms ?? []) {
      if (!includesLoose(draft, term)) {
        findings.push({ category: "terms", severity: "warning", message: `Required term is missing: ${term}.` });
      }
    }

    for (const canon of input.lockedCanon ?? []) {
      if (canon.startsWith("!")) {
        const forbidden = canon.slice(1).trim();
        if (forbidden && includesLoose(draft, forbidden)) {
          findings.push({
            category: "canon-conflict",
            severity: "error",
            message: `Draft conflicts with locked canon: ${forbidden}.`
          });
        }
      }
    }

    return findings;
  }

  private scoreCategories(findings: ReviewFinding[]): Record<ReviewCategory, number> {
    const scores: Record<ReviewCategory, number> = {
      "scene-goal": 100,
      "character-voice": 100,
      terms: 100,
      "canon-conflict": 100
    };
    for (const finding of findings) {
      scores[finding.category] -= finding.severity === "error" ? 35 : finding.severity === "warning" ? 18 : 5;
    }
    for (const category of categories) {
      scores[category] = Math.max(0, scores[category]);
    }
    return scores;
  }
}
