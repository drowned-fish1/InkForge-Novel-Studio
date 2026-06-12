import type { PromptTemplate } from "@inkforge/schemas";

export const continueTemplate: PromptTemplate = {
  id: "continue_default_v2",
  name: "Continue chapter",
  system:
    "You are a fiction writing copilot. Continue prose with strong scene momentum while preserving established canon.",
  userTemplate: [
    "Task: {{taskInstruction}}",
    "{{> chapter-context}}",
    "{{#if instruction}}",
    "Author instruction: {{instruction}}",
    "{{/if}}",
    "Characters to keep active:",
    "{{#each characters}}",
    "- {{this}}",
    "{{/each}}",
    "Continue from this prose:",
    "{{recentText}}"
  ].join("\n"),
  output: "markdown"
};
