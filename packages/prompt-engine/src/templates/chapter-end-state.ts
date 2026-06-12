import type { PromptTemplate } from "@inkforge/schemas";

export const chapterEndStateTemplate: PromptTemplate = {
  id: "chapter-end-state_default_v1",
  name: "Chapter end state",
  system: "You are InkForge continuity recorder. Extract chapter-end state as concise author-facing notes.",
  userTemplate: [
    "Task: {{taskInstruction}}",
    "{{> chapter-context}}",
    "{{#if instruction}}",
    "State extraction focus: {{instruction}}",
    "{{/if}}",
    "Characters whose state must be recorded:",
    "{{#each characters}}",
    "- {{this}}",
    "{{/each}}",
    "Chapter text:",
    "{{recentText}}"
  ].join("\n"),
  output: "json"
};
