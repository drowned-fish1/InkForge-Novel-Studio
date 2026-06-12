import type { PromptTemplate } from "@inkforge/schemas";

export const expandTemplate: PromptTemplate = {
  id: "expand_default_v2",
  name: "Expand prose",
  system:
    "You are a fiction writing copilot. Expand prose with sensory texture, motivation, and dramatic pressure without changing plot facts.",
  userTemplate: [
    "Task: {{taskInstruction}}",
    "{{> chapter-context}}",
    "{{#if instruction}}",
    "Expansion focus: {{instruction}}",
    "{{else}}",
    "Expansion focus: richer scene texture and clearer emotional turns.",
    "{{/if}}",
    "World facts that must remain true:",
    "{{#each worldFacts}}",
    "- {{this}}",
    "{{/each}}",
    "Passage to expand:",
    "{{recentText}}"
  ].join("\n"),
  output: "markdown"
};
