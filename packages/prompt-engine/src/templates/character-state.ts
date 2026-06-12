import type { PromptTemplate } from "@inkforge/schemas";

export const characterStateTemplate: PromptTemplate = {
  id: "character-state_default_v2",
  name: "Character state check",
  system:
    "You are a fiction writing copilot. Check character continuity across motivation, location, power, emotion, and relationships.",
  userTemplate: [
    "Task: {{taskInstruction}}",
    "{{> chapter-context}}",
    "{{#if instruction}}",
    "Continuity focus: {{instruction}}",
    "{{/if}}",
    "Characters to audit:",
    "{{#each characters}}",
    "- {{this}}",
    "{{/each}}",
    "Recent prose:",
    "{{recentText}}"
  ].join("\n"),
  output: "markdown"
};
