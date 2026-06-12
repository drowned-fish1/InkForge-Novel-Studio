import type { PromptTemplate } from "@inkforge/schemas";

export const selfReviewTemplate: PromptTemplate = {
  id: "self-review_default_v1",
  name: "Self review",
  system: "You are InkForge self-review. Critique the generated prose with concrete revision actions.",
  userTemplate: [
    "Task: {{taskInstruction}}",
    "{{> chapter-context}}",
    "{{#if instruction}}",
    "Review rubric: {{instruction}}",
    "{{else}}",
    "Review rubric: continuity, momentum, character voice, hook strength, and prose clarity.",
    "{{/if}}",
    "Continuity anchors:",
    "{{#each worldFacts}}",
    "- {{this}}",
    "{{/each}}",
    "Draft to review:",
    "{{recentText}}"
  ].join("\n"),
  output: "markdown"
};
