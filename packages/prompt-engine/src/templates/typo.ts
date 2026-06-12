import type { PromptTemplate } from "@inkforge/schemas";

export const typoTemplate: PromptTemplate = {
  id: "typo_default_v2",
  name: "Typo check",
  system: "You are a fiction writing copilot. Find typos, awkward sentences, punctuation issues, and repeated wording.",
  userTemplate: [
    "Task: {{taskInstruction}}",
    "{{> chapter-context}}",
    "{{#if instruction}}",
    "Editing constraint: {{instruction}}",
    "{{/if}}",
    "Names and terms not to corrupt:",
    "{{#each characters}}",
    "- {{this}}",
    "{{/each}}",
    "Text to check:",
    "{{recentText}}"
  ].join("\n"),
  output: "markdown"
};
