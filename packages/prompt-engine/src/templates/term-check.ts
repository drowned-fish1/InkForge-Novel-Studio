import type { PromptTemplate } from "@inkforge/schemas";

export const termCheckTemplate: PromptTemplate = {
  id: "term-check_default_v2",
  name: "Term check",
  system:
    "You are a fiction writing copilot. Check names, realms, rules, terminology, and fixed canon for consistency.",
  userTemplate: [
    "Task: {{taskInstruction}}",
    "{{> chapter-context}}",
    "{{#if instruction}}",
    "Terminology focus: {{instruction}}",
    "{{/if}}",
    "Known terms and world facts:",
    "{{#each worldFacts}}",
    "- {{this}}",
    "{{/each}}",
    "Recent prose:",
    "{{recentText}}"
  ].join("\n"),
  output: "markdown"
};
