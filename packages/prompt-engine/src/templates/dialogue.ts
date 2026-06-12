import type { PromptTemplate } from "@inkforge/schemas";

export const dialogueTemplate: PromptTemplate = {
  id: "dialogue_default_v2",
  name: "Dialogue pass",
  system:
    "You are a fiction writing copilot. Strengthen dialogue, subtext, and character voice without overexplaining.",
  userTemplate: [
    "Task: {{taskInstruction}}",
    "{{> chapter-context}}",
    "{{#if instruction}}",
    "Dialogue note: {{instruction}}",
    "{{/if}}",
    "Voices in this scene:",
    "{{#each characters}}",
    "- {{this}}",
    "{{/each}}",
    "Recent prose needing dialogue work:",
    "{{recentText}}"
  ].join("\n"),
  output: "markdown"
};
