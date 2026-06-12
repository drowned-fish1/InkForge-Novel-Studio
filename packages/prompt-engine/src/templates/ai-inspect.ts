import type { PromptTemplate } from "@inkforge/schemas";

export const aiInspectTemplate: PromptTemplate = {
  id: "ai-inspect_default_v2",
  name: "AI consistency check",
  system: "You are InkForge consistency inspector. Output ONLY valid JSON.",
  userTemplate: [
    "Task: {{taskInstruction}}",
    "{{#if instruction}}",
    "Inspection focus: {{instruction}}",
    "{{/if}}",
    "Chapter: {{chapterTitle}}",
    "Goal: {{chapterGoal}}",
    "Characters:",
    "{{#each characters}}",
    "- {{this}}",
    "{{/each}}",
    "World facts:",
    "{{#each worldFacts}}",
    "- {{this}}",
    "{{/each}}",
    "Project data or prose:",
    "{{recentText}}"
  ].join("\n"),
  output: "json"
};
