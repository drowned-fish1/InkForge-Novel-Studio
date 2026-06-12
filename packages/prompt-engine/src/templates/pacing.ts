import type { PromptTemplate } from "@inkforge/schemas";

export const pacingTemplate: PromptTemplate = {
  id: "pacing_default_v2",
  name: "Pacing check",
  system: "You are a fiction writing copilot. Diagnose pacing with specific fixes and avoid generic advice.",
  userTemplate: [
    "Task: {{taskInstruction}}",
    "{{> chapter-context}}",
    "{{#if instruction}}",
    "Pacing concern: {{instruction}}",
    "{{/if}}",
    "Character pressure points:",
    "{{#each characters}}",
    "- {{this}}",
    "{{/each}}",
    "Chapter material:",
    "{{recentText}}"
  ].join("\n"),
  output: "markdown"
};
