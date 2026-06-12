import type { PromptTemplate } from "@inkforge/schemas";

export const preExportTemplate: PromptTemplate = {
  id: "pre-export_default_v2",
  name: "Pre-export check",
  system: "You are a fiction writing copilot. Run final structural checks before export and report concrete fixes.",
  userTemplate: [
    "Task: {{taskInstruction}}",
    "{{> chapter-context}}",
    "{{#if instruction}}",
    "Export note: {{instruction}}",
    "{{/if}}",
    "Known continuity anchors:",
    "{{#each worldFacts}}",
    "- {{this}}",
    "{{/each}}",
    "Chapter draft:",
    "{{recentText}}"
  ].join("\n"),
  output: "markdown"
};
