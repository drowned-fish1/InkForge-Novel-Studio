import { PromptTemplateSchema, type PromptTemplate } from "@inkforge/schemas";
import { actionTemplate } from "./templates/action.js";
import { aiInspectTemplate } from "./templates/ai-inspect.js";
import { chapterEndStateTemplate } from "./templates/chapter-end-state.js";
import { characterStateTemplate } from "./templates/character-state.js";
import { clueCheckTemplate } from "./templates/clue-check.js";
import { continueTemplate } from "./templates/continue.js";
import { decisionAnalyzeTemplate } from "./templates/decision-analyze.js";
import { dialogueTemplate } from "./templates/dialogue.js";
import { expandTemplate } from "./templates/expand.js";
import { nextGoalTemplate } from "./templates/next-goal.js";
import { pacingTemplate } from "./templates/pacing.js";
import { planSceneTemplate } from "./templates/plan-scene.js";
import { polishTemplate } from "./templates/polish.js";
import { preExportTemplate } from "./templates/pre-export.js";
import { rewriteTemplate } from "./templates/rewrite.js";
import { selfReviewTemplate } from "./templates/self-review.js";
import { summaryTemplate } from "./templates/summary.js";
import { termCheckTemplate } from "./templates/term-check.js";
import { typoTemplate } from "./templates/typo.js";

export type PromptTask =
  | "continue"
  | "expand"
  | "rewrite"
  | "dialogue"
  | "action"
  | "summary"
  | "next-goal"
  | "pacing"
  | "character-state"
  | "clue-check"
  | "term-check"
  | "polish"
  | "typo"
  | "pre-export"
  | "ai-inspect"
  | "plan-scene"
  | "self-review"
  | "chapter-end-state"
  | "decision-analyze";

export const defaultPromptPartials = {
  "chapter-context": [
    "Chapter title: {{chapterTitle}}",
    "Chapter goal: {{chapterGoal}}",
    "Writing style: {{style}}"
  ].join("\n")
} as const;

export const taskInstructions: Record<PromptTask, string> = {
  continue: "Continue the current chapter and output Markdown prose that can be reviewed by the author.",
  expand: "Expand the recent prose with richer scene texture without changing established plot facts.",
  rewrite: "Rewrite the recent prose while preserving plot facts, improving rhythm and expression.",
  dialogue: "Add or strengthen character dialogue in the recent prose so the voices fit their states.",
  action: "Add action beats, blocking, and scene movement so the passage has stronger momentum.",
  polish: "Polish the recent prose while preserving plot facts, then output the improved version.",
  summary: "Summarize the current chapter, including plot, character changes, foreshadowing, and setting changes.",
  "next-goal":
    "Generate the next chapter goal, conflict point, and ending hook from the current goal and recent prose.",
  pacing: "Check chapter pacing and point out slow sections, jumps, weak payoffs, or weak hooks.",
  "character-state":
    "Check character continuity, including motivation, location, relationships, abilities, and emotions.",
  "clue-check": "Check foreshadowing setup, advancement, and payoff clarity; list omissions and suggestions.",
  "term-check": "Check whether terms, realms, names, and fixed canon are used consistently.",
  typo: "Check typos, awkward sentences, punctuation, and repeated wording; output only issues and suggestions.",
  "pre-export":
    "Run a pre-export check for headings, blank lines, unfinished markers, structure, and obvious omissions.",
  "ai-inspect":
    "Analyze the provided project data for contradictions, timeline inconsistencies, power level breaks, foreshadowing gaps, and terminology conflicts. Output a JSON array of issues with keys: type, severity, description, location.",
  "plan-scene": "Plan the next scene with beats, emotional turns, constraints, and a clear end state.",
  "self-review": "Review the draft for continuity, pacing, character voice, prose quality, and revision priorities.",
  "chapter-end-state":
    "Extract the chapter-end continuity state for characters, clues, world changes, unresolved threads, and next seeds.",
  "decision-analyze":
    "Analyze a story decision and compare options by consequence, risk, payoff, and continuity impact."
};

export const defaultPromptTemplates: Record<PromptTask, PromptTemplate> = {
  continue: continueTemplate,
  expand: expandTemplate,
  rewrite: rewriteTemplate,
  dialogue: dialogueTemplate,
  action: actionTemplate,
  summary: summaryTemplate,
  "next-goal": nextGoalTemplate,
  pacing: pacingTemplate,
  "character-state": characterStateTemplate,
  "clue-check": clueCheckTemplate,
  "term-check": termCheckTemplate,
  polish: polishTemplate,
  typo: typoTemplate,
  "pre-export": preExportTemplate,
  "ai-inspect": aiInspectTemplate,
  "plan-scene": planSceneTemplate,
  "self-review": selfReviewTemplate,
  "chapter-end-state": chapterEndStateTemplate,
  "decision-analyze": decisionAnalyzeTemplate
};

export const promptTasks = Object.keys(defaultPromptTemplates) as PromptTask[];

export const getDefaultPromptTemplate = (task: PromptTask): PromptTemplate =>
  PromptTemplateSchema.parse(defaultPromptTemplates[task]);
