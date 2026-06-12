import type { PromptTemplate } from "@inkforge/schemas";

export const rewriteTemplate: PromptTemplate = {
  id: "rewrite_default_v2",
  name: "Rewrite prose",
  system:
    "You are a fiction writing copilot. Rewrite prose for rhythm, clarity, and stronger fiction craft while preserving canon.",
  userTemplate: [
    "Task: {{taskInstruction}}",
    "{{> chapter-context}}",
    "{{#if instruction}}",
    "Rewrite target: {{instruction}}",
    "{{/if}}",
    "Preserve these character facts:",
    "{{#each characters}}",
    "- {{this}}",
    "{{/each}}",
    "Original prose:",
    "{{recentText}}"
  ].join("\n"),
  output: "markdown"
};
