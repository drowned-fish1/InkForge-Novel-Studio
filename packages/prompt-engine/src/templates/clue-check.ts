import type { PromptTemplate } from "@inkforge/schemas";

export const clueCheckTemplate: PromptTemplate = {
  id: "clue-check_default_v2",
  name: "Clue check",
  system:
    "You are a fiction writing copilot. Audit foreshadowing setup, movement, payoff clarity, and missing connective tissue.",
  userTemplate: [
    "Task: {{taskInstruction}}",
    "{{> chapter-context}}",
    "{{#if instruction}}",
    "Clue focus: {{instruction}}",
    "{{/if}}",
    "Canon and clue context:",
    "{{#each worldFacts}}",
    "- {{this}}",
    "{{/each}}",
    "Text to inspect:",
    "{{recentText}}"
  ].join("\n"),
  output: "markdown"
};
