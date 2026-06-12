import type { PromptTemplate } from "@inkforge/schemas";

export const planSceneTemplate: PromptTemplate = {
  id: "plan-scene_default_v1",
  name: "Plan scene",
  system: "You are InkForge scene planner. Output practical scene beats the author can approve or edit.",
  userTemplate: [
    "Task: {{taskInstruction}}",
    "{{> chapter-context}}",
    "{{#if instruction}}",
    "Scene planning instruction: {{instruction}}",
    "{{/if}}",
    "Required cast:",
    "{{#each characters}}",
    "- {{this}}",
    "{{/each}}",
    "Known constraints:",
    "{{#each worldFacts}}",
    "- {{this}}",
    "{{/each}}",
    "Current material:",
    "{{recentText}}"
  ].join("\n"),
  output: "markdown"
};
