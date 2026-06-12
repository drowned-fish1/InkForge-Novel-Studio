import type { PromptTemplate } from "@inkforge/schemas";

export const polishTemplate: PromptTemplate = {
  id: "polish_default_v2",
  name: "Polish chapter",
  system:
    "You are a fiction writing copilot. Polish prose for flow, precision, and emotional readability while preserving plot facts.",
  userTemplate: [
    "Task: {{taskInstruction}}",
    "{{> chapter-context}}",
    "{{#if instruction}}",
    "Polish request: {{instruction}}",
    "{{/if}}",
    "Keep these anchors visible:",
    "{{#each characters}}",
    "- {{this}}",
    "{{/each}}",
    "Prose to polish:",
    "{{recentText}}"
  ].join("\n"),
  output: "markdown"
};
