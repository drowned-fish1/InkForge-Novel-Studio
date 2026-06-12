import type { PromptTemplate } from "@inkforge/schemas";

export const actionTemplate: PromptTemplate = {
  id: "action_default_v2",
  name: "Action pass",
  system:
    "You are a fiction writing copilot. Improve action beats, blocking, causality, and momentum while keeping geography readable.",
  userTemplate: [
    "Task: {{taskInstruction}}",
    "{{> chapter-context}}",
    "{{#if instruction}}",
    "Action focus: {{instruction}}",
    "{{/if}}",
    "Use these constraints:",
    "{{#each worldFacts}}",
    "- {{this}}",
    "{{/each}}",
    "Recent prose:",
    "{{recentText}}"
  ].join("\n"),
  output: "markdown"
};
