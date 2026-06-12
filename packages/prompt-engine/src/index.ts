import { PromptTemplateSchema, type PromptTemplate } from "@inkforge/schemas";
import { renderTemplate, stringifyTemplateValue, type TemplatePartials, type TemplateVariables } from "./template.js";
import { defaultPromptPartials, getDefaultPromptTemplate, taskInstructions, type PromptTask } from "./templates.js";

export * from "./template.js";
export { defaultPromptPartials, defaultPromptTemplates, promptTasks, taskInstructions } from "./templates.js";
export type { PromptTask } from "./templates.js";

export interface PromptTaskInput {
  task: PromptTask;
  instruction?: string;
  chapterTitle: string;
  chapterGoal: string;
  recentText: string;
  characters: string[];
  worldFacts: string[];
  style: string;
}

export type PromptVariables = TemplateVariables;

export interface RenderedPrompt {
  id: string;
  name: string;
  system: string;
  user: string;
  output: PromptTemplate["output"];
  contextSummary: string;
  generatedAt: string;
}

export const promptTemplateFileName = (task: PromptTask): string => `${task}.prompt.json`;

export const createDefaultPromptTemplate = (task: PromptTask): PromptTemplate => getDefaultPromptTemplate(task);

export const parsePromptTemplate = (value: unknown): PromptTemplate => PromptTemplateSchema.parse(value);

export const variablesFromTaskInput = (input: PromptTaskInput): PromptVariables => ({
  task: input.task,
  taskInstruction: taskInstructions[input.task],
  instruction: input.instruction?.trim() || "",
  chapterTitle: input.chapterTitle,
  chapterGoal: input.chapterGoal || "Not provided",
  recentText: input.recentText,
  characters: input.characters,
  worldFacts: input.worldFacts,
  style: input.style
});

export const renderPrompt = (
  template: PromptTemplate,
  variables: PromptVariables,
  now = new Date(),
  partials: TemplatePartials = defaultPromptPartials
): RenderedPrompt => {
  const user = renderTemplate(template.userTemplate, variables, partials);

  const filledKeys = Object.keys(variables).filter((key) => stringifyTemplateValue(variables[key]).length > 0);

  return {
    id: template.id,
    name: template.name,
    system: template.system,
    user,
    output: template.output,
    contextSummary: filledKeys.length > 0 ? `Variables: ${filledKeys.join(", ")}` : "No prompt variables provided",
    generatedAt: now.toISOString()
  };
};

export const renderTaskPrompt = (template: PromptTemplate, input: PromptTaskInput, now = new Date()): RenderedPrompt =>
  renderPrompt(template, variablesFromTaskInput(input), now);

/* ── Planning mode ─────────────────────────────────── */

export type PlanningMode = "questions" | "package";

export const promptPlanningTemplateFileName = (mode: PlanningMode): string => `planning-${mode}.prompt.json`;

const defaultPlanningSystemPrompt = (mode: PlanningMode): string => {
  if (mode === "questions") {
    return [
      "You are InkForge planning mode for long-form Chinese web novels.",
      "Ask 3-6 high-value clarifying questions before generating a plan.",
      "If existingCharacters / existingWorldEntries / existingTerms are provided, reference them rather than asking the author to redefine them.",
      "Keep questions concise and actionable. Do not output JSON in this mode."
    ].join("\n");
  }
  return [
    "You are InkForge planning mode. Output ONLY valid JSON.",
    "The JSON must match this structure: { meta, worldEntries, characters, timeline, terms, clues, outline }.",
    "If existingCharacters / existingWorldEntries / existingTerms are provided, avoid creating duplicate entries — instead reference existing ids or extend existing entries.",
    "Use stable lowercase ids. Put power systems in worldEntries with type power-system and levels in terms with category 境界.",
    "Every outline must include schemaVersion matching the project schema."
  ].join("\n");
};

const defaultPlanningUserTemplate = [
  "Mode: {{mode}}",
  "Project title: {{projectTitle}}",
  "Premise: {{premise}}",
  "{{#if userMessage}}",
  "User message: {{userMessage}}",
  "{{/if}}",
  "{{#if existingCharacters}}",
  "Existing characters: {{existingCharacters}}",
  "{{/if}}",
  "{{#if existingWorldEntries}}",
  "Existing world entries: {{existingWorldEntries}}",
  "{{/if}}",
  "{{#if existingTimeline}}",
  "Existing timeline: {{existingTimeline}}",
  "{{/if}}",
  "{{#if existingTerms}}",
  "Existing terms: {{existingTerms}}",
  "{{/if}}",
  "{{#if existingClues}}",
  "Existing clues: {{existingClues}}",
  "{{/if}}",
  "{{#if history}}",
  "Conversation history: {{history}}",
  "{{/if}}",
  "{{#if currentPackage}}",
  "Current package: {{currentPackage}}",
  "{{/if}}"
].join("\n");

export interface PlanningPromptInput {
  mode: PlanningMode;
  projectTitle: string;
  premise: string;
  userMessage?: string;
  existingCharacters: string;
  existingWorldEntries: string;
  existingTimeline: string;
  existingTerms: string;
  existingClues: string;
  history: string;
  currentPackage: string;
}

export const createDefaultPlanningPrompt = (mode: PlanningMode): PromptTemplate =>
  PromptTemplateSchema.parse({
    id: `planning_${mode}_default_v1`,
    name: mode === "questions" ? "Planning questions" : "Planning package",
    system: defaultPlanningSystemPrompt(mode),
    userTemplate: defaultPlanningUserTemplate,
    output: mode === "package" ? "json" : "markdown"
  });

const summarizeJsonArray = (items: Array<Record<string, unknown>>, keys: string[]): string => {
  if (items.length === 0) return "";
  return JSON.stringify(
    items.map((item) => {
      const picked: Record<string, unknown> = {};
      for (const key of keys) {
        if (item[key] !== undefined) picked[key] = item[key];
      }
      return picked;
    })
  );
};

export const variablesFromPlanningInput = (input: PlanningPromptInput): PromptVariables => {
  const libContext =
    input.existingCharacters && input.existingCharacters !== "None" ? JSON.parse(input.existingCharacters) : [];
  const worldContext =
    input.existingWorldEntries && input.existingWorldEntries !== "None" ? JSON.parse(input.existingWorldEntries) : [];
  const timelineContext =
    input.existingTimeline && input.existingTimeline !== "None" ? JSON.parse(input.existingTimeline) : [];
  const termsContext = input.existingTerms && input.existingTerms !== "None" ? JSON.parse(input.existingTerms) : [];
  const cluesContext = input.existingClues && input.existingClues !== "None" ? JSON.parse(input.existingClues) : [];

  return {
    mode: input.mode,
    projectTitle: input.projectTitle,
    premise: input.premise || "Not provided",
    userMessage: input.userMessage || "",
    existingCharacters: summarizeJsonArray(libContext, ["name", "role", "identity", "motivation", "powerLevel"]),
    existingWorldEntries: summarizeJsonArray(worldContext, ["title", "type", "summary", "locked"]),
    existingTimeline: summarizeJsonArray(timelineContext, ["title", "chapterId", "location"]),
    existingTerms: summarizeJsonArray(termsContext, ["name", "category", "definition", "locked"]),
    existingClues: summarizeJsonArray(cluesContext, ["title", "status", "plantedChapterId", "expectedPayoff"]),
    history: input.history,
    currentPackage: input.currentPackage
  };
};
