import { z } from "zod";

export const AgentSchemaVersion = "0.1.0";

export const PipelineStepKindSchema = z.enum([
  "context",
  "plan",
  "draft",
  "review",
  "revise",
  "summarize",
  "decision",
  "export"
]);

export const PipelineStepSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: PipelineStepKindSchema,
  promptTemplateId: z.string().min(1).optional(),
  dependsOn: z.array(z.string().min(1)).default([]),
  requiredInputs: z.array(z.string().min(1)).default([]),
  produces: z.array(z.string().min(1)).default([]),
  retryLimit: z.number().int().nonnegative().default(0),
  timeoutMs: z.number().int().positive().optional(),
  enabled: z.boolean().default(true)
});

export const PipelineSchema = z.object({
  schemaVersion: z.literal(AgentSchemaVersion).default(AgentSchemaVersion),
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1).default("1.0.0"),
  description: z.string().default(""),
  trigger: z.enum(["manual", "chapter", "scene", "session"]).default("manual"),
  steps: z.array(PipelineStepSchema).min(1),
  defaultVariables: z.record(z.string(), z.unknown()).default({}),
  tags: z.array(z.string()).default([]),
  enabled: z.boolean().default(true)
});

export const DecisionOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().default(""),
  risks: z.array(z.string()).default([]),
  payoff: z.string().default("")
});

export const DecisionPointSchema = z.object({
  id: z.string().min(1),
  chapterId: z.string().min(1).optional(),
  sceneId: z.string().min(1).optional(),
  label: z.string().min(1),
  question: z.string().min(1),
  options: z
    .array(DecisionOptionSchema)
    .min(1)
    .default([
      {
        id: "option-1",
        label: "Decide later",
        description: "",
        risks: [],
        payoff: ""
      }
    ]),
  selectedOptionId: z.string().min(1).optional(),
  rationale: z.string().default(""),
  status: z.enum(["open", "resolved", "deferred"]).default("open"),
  impact: z.enum(["low", "medium", "high"]).default("medium"),
  relatedSceneIds: z.array(z.string().min(1)).default([]),
  createdAt: z.string().default(""),
  decidedAt: z.string().optional()
});

export const SceneBeatSchema = z.object({
  id: z.string().min(1),
  order: z.number().int().nonnegative(),
  purpose: z.string().default(""),
  action: z.string().default(""),
  emotionalTurn: z.string().default(""),
  reveals: z.array(z.string()).default([])
});

export const ScenePlanSchema = z.object({
  schemaVersion: z.literal(AgentSchemaVersion).default(AgentSchemaVersion),
  id: z.string().min(1),
  chapterId: z.string().min(1),
  order: z.number().int().nonnegative(),
  title: z.string().min(1),
  povCharacterId: z.string().min(1).optional(),
  location: z.string().default(""),
  time: z.string().default(""),
  goal: z.string().default(""),
  conflict: z.string().default(""),
  outcome: z.string().default(""),
  beats: z.array(SceneBeatSchema).default([]),
  requiredCharacters: z.array(z.string().min(1)).default([]),
  worldRefs: z.array(z.string().min(1)).default([]),
  clueRefs: z.array(z.string().min(1)).default([]),
  decisionPoints: z.array(DecisionPointSchema).default([]),
  notes: z.string().default("")
});

export const ChapterEndCharacterStateSchema = z.object({
  characterId: z.string().min(1),
  location: z.string().default(""),
  motivation: z.string().default(""),
  emotionalState: z.string().default(""),
  relationshipChanges: z.array(z.string()).default([]),
  powerState: z.string().default("")
});

export const ChapterEndStateSchema = z.object({
  schemaVersion: z.literal(AgentSchemaVersion).default(AgentSchemaVersion),
  chapterId: z.string().min(1),
  chapterTitle: z.string().default(""),
  completedAt: z.string().default(""),
  summary: z.string().default(""),
  finalHook: z.string().default(""),
  unresolvedThreads: z.array(z.string()).default([]),
  characterStates: z.array(ChapterEndCharacterStateSchema).default([]),
  worldStateChanges: z.array(z.string()).default([]),
  clueUpdates: z.array(z.string()).default([]),
  nextChapterSeeds: z.array(z.string()).default([]),
  qualityNotes: z.array(z.string()).default([])
});

export const WritingSessionSchema = z.object({
  schemaVersion: z.literal(AgentSchemaVersion).default(AgentSchemaVersion),
  id: z.string().min(1),
  projectId: z.string().min(1),
  chapterId: z.string().min(1),
  pipelineId: z.string().min(1).optional(),
  currentStepId: z.string().min(1).optional(),
  status: z.enum(["idle", "planning", "drafting", "reviewing", "paused", "completed", "failed"]).default("idle"),
  providerId: z.string().default(""),
  model: z.string().default(""),
  targetWords: z.number().int().positive().default(3000),
  actualWords: z.number().int().nonnegative().default(0),
  scenePlans: z.array(ScenePlanSchema).default([]),
  decisions: z.array(DecisionPointSchema).default([]),
  contextSummary: z.string().default(""),
  notes: z.string().default(""),
  startedAt: z.string().default(""),
  updatedAt: z.string().default(""),
  endedAt: z.string().optional()
});

export const PipelineExecutionStepSchema = z.object({
  stepId: z.string().min(1),
  status: z.enum(["pending", "running", "completed", "skipped", "failed"]).default("pending"),
  attempts: z.number().int().nonnegative().default(0),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  inputSummary: z.string().default(""),
  outputSummary: z.string().default(""),
  error: z.string().default("")
});

export const PipelineExecutionSchema = z.object({
  schemaVersion: z.literal(AgentSchemaVersion).default(AgentSchemaVersion),
  id: z.string().min(1),
  pipelineId: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  chapterId: z.string().min(1).optional(),
  status: z.enum(["pending", "running", "completed", "failed", "cancelled"]).default("pending"),
  currentStepId: z.string().min(1).optional(),
  steps: z.array(PipelineExecutionStepSchema).default([]),
  inputs: z.record(z.string(), z.unknown()).default({}),
  outputs: z.record(z.string(), z.unknown()).default({}),
  errors: z.array(z.string()).default([]),
  startedAt: z.string().default(""),
  completedAt: z.string().optional(),
  metrics: z
    .object({
      promptTokens: z.number().int().nonnegative().default(0),
      completionTokens: z.number().int().nonnegative().default(0),
      elapsedMs: z.number().int().nonnegative().default(0)
    })
    .default({
      promptTokens: 0,
      completionTokens: 0,
      elapsedMs: 0
    })
});

export type PipelineStepKind = z.infer<typeof PipelineStepKindSchema>;
export type PipelineStep = z.infer<typeof PipelineStepSchema>;
export type Pipeline = z.infer<typeof PipelineSchema>;
export type DecisionOption = z.infer<typeof DecisionOptionSchema>;
export type DecisionPoint = z.infer<typeof DecisionPointSchema>;
export type SceneBeat = z.infer<typeof SceneBeatSchema>;
export type ScenePlan = z.infer<typeof ScenePlanSchema>;
export type ChapterEndCharacterState = z.infer<typeof ChapterEndCharacterStateSchema>;
export type ChapterEndState = z.infer<typeof ChapterEndStateSchema>;
export type WritingSession = z.infer<typeof WritingSessionSchema>;
export type PipelineExecutionStep = z.infer<typeof PipelineExecutionStepSchema>;
export type PipelineExecution = z.infer<typeof PipelineExecutionSchema>;
