import { z } from "zod";
import { defaultProviderConfig } from "./defaults.js";

export * from "./defaults.js";
export * from "./agent.js";
export * from "./export.js";
export * from "./narrative.js";
export * from "./production.js";
export * from "./references.js";
export * from "./simulation.js";
export * from "./workspace.js";

export const inkforgeSchemaVersion = "0.1.0";

export const WritingPreferencesSchema = z.object({
  pov: z.string().default("第三人称有限视角"),
  style: z.string().default("节奏快，冲突强，少解释，多行动"),
  chapterWords: z.number().int().positive().default(3000)
});

export const ProjectMetaSchema = z.object({
  schemaVersion: z.literal(inkforgeSchemaVersion),
  projectId: z.string().min(1),
  title: z.string().min(1),
  author: z.string().min(1).default("local-user"),
  genre: z.array(z.string()).default([]),
  targetWords: z.number().int().positive().default(1000000),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  defaultProviderId: z.string().default(defaultProviderConfig.providerId),
  defaultModel: z.string().default(defaultProviderConfig.model),
  writingPreferences: WritingPreferencesSchema.default({
    pov: "第三人称有限视角",
    style: "节奏快，冲突强，少解释，多行动",
    chapterWords: 3000
  })
});

export const ChapterStatusSchema = z.enum(["unplanned", "planned", "drafting", "revising", "done"]);

export const ChapterPlanSchema = z.object({
  id: z.string().min(1),
  number: z.number().int().positive(),
  title: z.string().min(1),
  file: z.string().min(1),
  goal: z.string().default(""),
  hook: z.string().default(""),
  status: ChapterStatusSchema.default("planned"),
  targetWords: z.number().int().positive().default(3000),
  actualWords: z.number().int().nonnegative().default(0),
  archived: z.boolean().default(false),
  notes: z.string().default(""),
  conflictPoints: z.string().default(""),
  characters: z.array(z.string()).default([]),
  worldRefs: z.array(z.string()).default([])
});

export const VolumePlanSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  goal: z.string().default(""),
  targetWords: z.number().int().positive().default(90000),
  chapters: z.array(ChapterPlanSchema).default([])
});

export const OutlineSchema = z.object({
  schemaVersion: z.literal(inkforgeSchemaVersion),
  premise: z.string().default(""),
  mainConflict: z.string().default(""),
  endingDirection: z.string().default(""),
  volumes: z.array(VolumePlanSchema).default([])
});

export const CharacterSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  role: z.string().default("supporting"),
  tags: z.array(z.string()).default([]),
  profile: z
    .object({
      age: z.string().default(""),
      identity: z.string().default(""),
      motivation: z.string().default(""),
      personality: z.string().default("")
    })
    .default({
      age: "",
      identity: "",
      motivation: "",
      personality: ""
    }),
  currentState: z
    .object({
      arc: z.string().default(""),
      powerLevel: z.string().default(""),
      location: z.string().default(""),
      relationships: z.array(z.string()).default([]),
      secrets: z.array(z.string()).default([])
    })
    .default({
      arc: "",
      powerLevel: "",
      location: "",
      relationships: [],
      secrets: []
    }),
  voiceNotes: z.string().default("")
});

export const WorldEntrySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  type: z
    .enum(["faction", "location", "rule", "power-system", "item", "skill", "history", "race", "organization", "note"])
    .default("note"),
  locked: z.boolean().default(false),
  tags: z.array(z.string()).default([]),
  summary: z.string().default(""),
  content: z.string().default(""),
  relatedCharacters: z.array(z.string()).default([]),
  relatedClues: z.array(z.string()).default([])
});

export const TimelineEventSchema = z.object({
  id: z.string().min(1),
  chapterId: z.string().optional(),
  order: z.number(),
  title: z.string().min(1),
  location: z.string().default(""),
  participants: z.array(z.string()).default([]),
  summary: z.string().default("")
});

export const ClueSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  plantedChapterId: z.string().optional(),
  relatedCharacters: z.array(z.string()).default([]),
  expectedPayoff: z.string().default(""),
  status: z.enum(["planned", "planted", "developed", "resolved", "abandoned"]).default("planned"),
  notes: z.string().default("")
});

export const ConflictSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  kind: z.enum(["main", "sub", "character", "faction"]).default("sub"),
  status: z.enum(["planned", "active", "escalating", "resolved", "abandoned"]).default("planned"),
  parties: z.array(z.string()).default([]),
  stakes: z.string().default(""),
  relatedCharacters: z.array(z.string()).default([]),
  relatedFactions: z.array(z.string()).default([]),
  chapterIds: z.array(z.string()).default([]),
  summary: z.string().default(""),
  notes: z.string().default("")
});

export const TermSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: z.string().default("term"),
  aliases: z.array(z.string()).default([]),
  definition: z.string().default(""),
  locked: z.boolean().default(false)
});

export const PromptTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  system: z.string().min(1),
  userTemplate: z.string().min(1),
  output: z.enum(["markdown", "json", "diff"]).default("markdown")
});

export const ChapterSummarySchema = z.object({
  schemaVersion: z.literal(inkforgeSchemaVersion),
  chapterId: z.string().min(1),
  chapterTitle: z.string().min(1),
  sourceTask: z
    .enum([
      "continue",
      "expand",
      "rewrite",
      "dialogue",
      "action",
      "summary",
      "next-goal",
      "pacing",
      "character-state",
      "clue-check",
      "term-check",
      "polish",
      "typo",
      "pre-export"
    ])
    .default("summary"),
  summaryText: z.string().default(""),
  rawOutput: z.string().default(""),
  providerId: z.string().default(""),
  model: z.string().default(""),
  contextSummary: z.string().default(""),
  generatedAt: z.string().default(""),
  savedAt: z.string()
});

export const PlanningMessageSchema = z.object({
  id: z.string().min(1),
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().default(""),
  createdAt: z.string()
});

export const PlanningPackageSchema = z.object({
  meta: z.object({
    title: z.string().min(1),
    logline: z.string().default(""),
    theme: z.string().default(""),
    sellingPoints: z.array(z.string()).default([])
  }),
  worldEntries: z.array(WorldEntrySchema).default([]),
  characters: z.array(CharacterSchema).default([]),
  timeline: z.array(TimelineEventSchema).default([]),
  terms: z.array(TermSchema).default([]),
  clues: z.array(ClueSchema).default([]),
  outline: OutlineSchema
});

export const PlanningSessionSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  title: z.string().min(1),
  status: z.enum(["clarifying", "ready", "imported"]).default("clarifying"),
  messages: z.array(PlanningMessageSchema).default([]),
  package: PlanningPackageSchema.optional(),
  rawOutput: z.string().default(""),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const PlanningImportSelectionSchema = z.object({
  characters: z.array(z.string()).default([]),
  worldEntries: z.array(z.string()).default([]),
  timeline: z.array(z.string()).default([]),
  terms: z.array(z.string()).default([]),
  clues: z.array(z.string()).default([]),
  outlineVolumeIds: z.array(z.string()).default([]),
  overwrite: z
    .object({
      characters: z.array(z.string()).default([]),
      worldEntries: z.array(z.string()).default([]),
      timeline: z.array(z.string()).default([]),
      terms: z.array(z.string()).default([]),
      clues: z.array(z.string()).default([]),
      outlineVolumeIds: z.array(z.string()).default([])
    })
    .default({
      characters: [],
      worldEntries: [],
      timeline: [],
      terms: [],
      clues: [],
      outlineVolumeIds: []
    })
});

export const PlanningImportResultSchema = z.object({
  snapshotId: z.string().min(1),
  added: z.record(z.string(), z.number()).default({}),
  skipped: z.record(z.string(), z.number()).default({}),
  errors: z.array(z.string()).default([])
});

export type WritingPreferences = z.infer<typeof WritingPreferencesSchema>;
export type ProjectMeta = z.infer<typeof ProjectMetaSchema>;
export type Outline = z.infer<typeof OutlineSchema>;
export type VolumePlan = z.infer<typeof VolumePlanSchema>;
export type ChapterStatus = z.infer<typeof ChapterStatusSchema>;
export type ChapterPlan = z.infer<typeof ChapterPlanSchema>;
export type Character = z.infer<typeof CharacterSchema>;
export type WorldEntry = z.infer<typeof WorldEntrySchema>;
export type TimelineEvent = z.infer<typeof TimelineEventSchema>;
export type Clue = z.infer<typeof ClueSchema>;
export type Conflict = z.infer<typeof ConflictSchema>;
export type Term = z.infer<typeof TermSchema>;
export type PromptTemplate = z.infer<typeof PromptTemplateSchema>;
export type ChapterSummary = z.infer<typeof ChapterSummarySchema>;
export type PlanningMessage = z.infer<typeof PlanningMessageSchema>;
export type PlanningPackage = z.infer<typeof PlanningPackageSchema>;
export type PlanningSession = z.infer<typeof PlanningSessionSchema>;
export type PlanningImportSelection = z.infer<typeof PlanningImportSelectionSchema>;
export type PlanningImportResult = z.infer<typeof PlanningImportResultSchema>;

export const createProjectId = (title: string, now = new Date()): string => {
  const normalized = title
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 36);
  const stamp = now.toISOString().slice(0, 10).replaceAll("-", "");
  return `novel_${stamp}_${normalized || "untitled"}`;
};
