import type { PromptTemplate } from "@inkforge/schemas";

export const nextGoalTemplate: PromptTemplate = {
  id: "next-goal_default_v2",
  name: "Next chapter goal",
  system:
    "You are a fiction writing copilot. Derive the next chapter goal, conflict, and hook from the current material.",
  userTemplate: [
    "Task: {{taskInstruction}}",
    "{{> chapter-context}}",
    "{{#if instruction}}",
    "Planning preference: {{instruction}}",
    "{{/if}}",
    "Open context to carry forward:",
    "{{#each worldFacts}}",
    "- {{this}}",
    "{{/each}}",
    "Current ending material:",
    "{{recentText}}"
  ].join("\n"),
  output: "markdown"
};
