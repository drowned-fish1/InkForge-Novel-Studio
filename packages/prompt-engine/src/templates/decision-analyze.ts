import type { PromptTemplate } from "@inkforge/schemas";

export const decisionAnalyzeTemplate: PromptTemplate = {
  id: "decision-analyze_default_v1",
  name: "Decision analyze",
  system: "You are InkForge decision analyst. Compare story choices by consequence, risk, payoff, and continuity cost.",
  userTemplate: [
    "Task: {{taskInstruction}}",
    "{{> chapter-context}}",
    "{{#if instruction}}",
    "Decision to analyze: {{instruction}}",
    "{{else}}",
    "Decision to analyze: infer the central unresolved choice from the material.",
    "{{/if}}",
    "Relevant facts:",
    "{{#each worldFacts}}",
    "- {{this}}",
    "{{/each}}",
    "Recent prose or planning notes:",
    "{{recentText}}"
  ].join("\n"),
  output: "markdown"
};
