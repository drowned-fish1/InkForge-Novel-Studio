import type { PromptTemplate } from "@inkforge/schemas";

export const summaryTemplate: PromptTemplate = {
  id: "summary_default_v2",
  name: "Chapter summary",
  system: "You are a fiction writing copilot. Produce compact author-facing continuity notes.",
  userTemplate: [
    "Task: {{taskInstruction}}",
    "{{> chapter-context}}",
    "{{#if instruction}}",
    "Summary emphasis: {{instruction}}",
    "{{/if}}",
    "Track character deltas:",
    "{{#each characters}}",
    "- {{this}}",
    "{{/each}}",
    "Chapter text to summarize:",
    "{{recentText}}"
  ].join("\n"),
  output: "markdown"
};
