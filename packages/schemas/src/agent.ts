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

export const AgentToolNameSchema = z.enum([
  "get_chapter_context",
  "get_chapter_memory",
  "get_outline_context",
  "prepare_narrative_deviation",
  "get_story_bible",
  "get_narrative_board",
  "get_simulation_runs",
  "inspect_continuity",
  "search_project",
  "semantic_search",
  "propose_chapter_edit",
  "propose_chapter_patch",
  "propose_scene_plan",
  "propose_outline_update",
  "propose_character_update",
  "propose_world_update",
  "propose_clue_update",
  "propose_term_update",
  "propose_timeline_event",
  "propose_beat_update"
]);

export const AgentSourceReferenceSchema = z.object({
  kind: z.enum(["chapter", "outline", "character", "world", "timeline", "clue", "term", "memory"]),
  id: z.string().min(1),
  title: z.string().min(1),
  snippet: z.string().default("")
});

export const AgentChatMessageSchema = z.object({
  id: z.string().min(1),
  role: z.enum(["user", "assistant", "tool"]),
  kind: z.enum(["message", "plan"]).optional(),
  content: z.string().default(""),
  agentId: z.string().min(1).optional(),
  agentName: z.string().min(1).optional(),
  collaborationRunId: z.string().min(1).optional(),
  collaborationTaskId: z.string().min(1).optional(),
  reasoning: z.string().optional(),
  createdAt: z.string(),
  branchId: z.string().min(1).optional(),
  favorite: z.boolean().optional(),
  planStatus: z.enum(["pending", "executing", "completed", "dismissed"]).optional(),
  toolName: AgentToolNameSchema.optional(),
  toolStatus: z.enum(["running", "completed", "failed"]).optional(),
  sources: z.array(AgentSourceReferenceSchema).default([]).optional()
});

export const AgentChatBranchSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  parentBranchId: z.string().min(1).optional(),
  forkedFromMessageId: z.string().min(1).optional(),
  createdAt: z.string()
});

export const AgentPatchBlockSchema = z.object({
  id: z.string().min(1),
  operation: z.enum(["insert_after", "replace", "delete"]),
  originalText: z.string().default(""),
  proposedText: z.string().default(""),
  explanation: z.string().default(""),
  status: z.enum(["pending", "accepted", "rejected"]).default("pending")
});

export const AgentChangeProposalSchema = z.object({
  id: z.string().min(1),
  chapterId: z.string().min(1),
  mode: z.enum(["append", "replace", "patch"]),
  content: z.string(),
  explanation: z.string().default(""),
  blocks: z.array(AgentPatchBlockSchema).max(20).default([]),
  baseContentHash: z.string().default(""),
  snapshotId: z.string().optional(),
  memorySnapshotId: z.string().optional(),
  sourceContent: z.string().optional(),
  review: z
    .object({
      sourceCharacters: z.number().int().nonnegative().default(0),
      finalCharacters: z.number().int().nonnegative().default(0),
      retainedRatio: z.number().nonnegative().default(1),
      removedFacts: z.array(z.string()).default([]),
      warnings: z.array(z.string()).default([]),
      sceneCount: z.number().int().nonnegative().default(0)
    })
    .optional(),
  status: z.enum(["pending", "applied", "rejected", "conflicted", "rolled_back"]).default("pending"),
  createdAt: z.string(),
  resolvedAt: z.string().optional()
});

export const AgentDataProposalSchema = z.object({
  id: z.string().min(1),
  entityType: z.enum(["scene", "outline", "character", "world", "clue", "term", "timeline", "beat"]),
  action: z.literal("upsert").default("upsert"),
  title: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  explanation: z.string().default(""),
  status: z.enum(["pending", "applied", "rejected"]).default("pending"),
  createdAt: z.string(),
  resolvedAt: z.string().optional()
});

export const ChapterMemorySchema = z.object({
  schemaVersion: z.literal(AgentSchemaVersion).default(AgentSchemaVersion),
  chapterId: z.string().min(1),
  summary: z.string().default(""),
  characterStates: z.array(ChapterEndCharacterStateSchema).default([]),
  unresolvedThreads: z.array(z.string()).default([]),
  clueUpdates: z.array(z.string()).default([]),
  worldStateChanges: z.array(z.string()).default([]),
  keywords: z.array(z.string()).default([]),
  updatedAt: z.string()
});

export const AgentPrivateTurnSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1).optional(),
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string().default(""),
  createdAt: z.string()
});

export const AgentRuntimeStateSchema = z.object({
  agentId: z.string().min(1),
  status: z.enum(["idle", "working", "waiting", "reviewing", "failed"]).default("idle"),
  allowedTools: z.array(AgentToolNameSchema).default([]),
  memory: z.array(z.string()).default([]),
  transcript: z.array(AgentPrivateTurnSchema).default([]),
  activeTaskId: z.string().min(1).optional()
});

export const AgentCollaborationTaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  instruction: z.string().default(""),
  assignedTo: z.string().min(1),
  createdBy: z.string().min(1),
  status: z.enum(["pending", "running", "submitted", "approved", "rework", "failed", "cancelled"]).default("pending"),
  dependencies: z.array(z.string()).default([]),
  allowedTools: z.array(AgentToolNameSchema).default([]),
  attempt: z.number().int().positive().default(1),
  maxAttempts: z.number().int().positive().max(5).default(2),
  result: z.string().default(""),
  feedback: z.string().default(""),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const AgentCollaborationMessageSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1).optional(),
  fromAgentId: z.string().min(1),
  toAgentIds: z.array(z.string().min(1)).default([]),
  kind: z.enum(["delegation", "handoff", "review", "feedback", "status"]),
  content: z.string().default(""),
  createdAt: z.string()
});

export const AgentCollaborationRunSchema = z.object({
  id: z.string().min(1),
  request: z.string().min(1),
  coordinatorId: z.string().min(1),
  participantIds: z.array(z.string().min(1)).min(2),
  status: z.enum(["running", "completed", "failed", "cancelled"]).default("running"),
  tasks: z.array(AgentCollaborationTaskSchema).default([]),
  messages: z.array(AgentCollaborationMessageSchema).default([]),
  agents: z.array(AgentRuntimeStateSchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const AgentChatSessionSchema = z.object({
  schemaVersion: z.literal(AgentSchemaVersion).default(AgentSchemaVersion),
  id: z.string().min(1),
  projectId: z.string().min(1),
  chapterId: z.string().min(1),
  title: z.string().min(1),
  messages: z.array(AgentChatMessageSchema).default([]),
  proposals: z.array(AgentChangeProposalSchema).default([]),
  dataProposals: z.array(AgentDataProposalSchema).default([]),
  collaborationRuns: z.array(AgentCollaborationRunSchema).default([]),
  branches: z.array(AgentChatBranchSchema).optional(),
  activeBranchId: z.string().min(1).optional(),
  updatedAt: z.string()
});

export const AgentRunUsageSchema = z.object({
  promptTokens: z.number().int().nonnegative().default(0),
  completionTokens: z.number().int().nonnegative().default(0),
  totalTokens: z.number().int().nonnegative().default(0)
});

export const AgentRunEventSchema = z.object({
  id: z.string().min(1),
  type: z.enum([
    "run_started",
    "context_prepared",
    "model_started",
    "reasoning_delta",
    "text_delta",
    "model_completed",
    "tool_started",
    "tool_completed",
    "tool_failed",
    "run_completed",
    "run_failed",
    "run_cancelled"
  ]),
  timestamp: z.string(),
  turn: z.number().int().nonnegative().optional(),
  toolName: AgentToolNameSchema.optional(),
  label: z.string().default(""),
  detail: z.string().default(""),
  durationMs: z.number().int().nonnegative().optional(),
  usage: AgentRunUsageSchema.optional()
});

export const AgentContextStatsSchema = z.object({
  tokenBudget: z.number().int().nonnegative().default(0),
  estimatedTokens: z.number().int().nonnegative().default(0),
  semanticHits: z.number().int().nonnegative().default(0),
  recentMemories: z.number().int().nonnegative().default(0),
  compressedMemories: z.number().int().nonnegative().default(0),
  omittedItems: z.number().int().nonnegative().default(0)
});

export const AgentRunTraceSchema = z.object({
  schemaVersion: z.literal(AgentSchemaVersion).default(AgentSchemaVersion),
  id: z.string().min(1),
  requestId: z.string().min(1),
  chapterId: z.string().min(1),
  userMessage: z.string().min(1),
  status: z.enum(["running", "completed", "failed", "cancelled"]).default("running"),
  model: z.string().default(""),
  mode: z.enum(["direct", "plan", "execute-plan"]).optional(),
  branchId: z.string().min(1).optional(),
  replayOf: z.string().optional(),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  durationMs: z.number().int().nonnegative().default(0),
  usage: AgentRunUsageSchema.default({
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0
  }),
  context: AgentContextStatsSchema.optional(),
  events: z.array(AgentRunEventSchema).default([]),
  error: z.string().default("")
});

export type AgentToolName = z.infer<typeof AgentToolNameSchema>;
export type AgentSourceReference = z.infer<typeof AgentSourceReferenceSchema>;
export type AgentChatMessage = z.infer<typeof AgentChatMessageSchema>;
export type AgentChatBranch = z.infer<typeof AgentChatBranchSchema>;
export type AgentPatchBlock = z.infer<typeof AgentPatchBlockSchema>;
export type AgentChangeProposal = z.infer<typeof AgentChangeProposalSchema>;
export type AgentDataProposal = z.infer<typeof AgentDataProposalSchema>;
export type ChapterMemory = z.infer<typeof ChapterMemorySchema>;
export type AgentPrivateTurn = z.infer<typeof AgentPrivateTurnSchema>;
export type AgentRuntimeState = z.infer<typeof AgentRuntimeStateSchema>;
export type AgentCollaborationTask = z.infer<typeof AgentCollaborationTaskSchema>;
export type AgentCollaborationMessage = z.infer<typeof AgentCollaborationMessageSchema>;
export type AgentCollaborationRun = z.infer<typeof AgentCollaborationRunSchema>;
export type AgentChatSession = z.infer<typeof AgentChatSessionSchema>;
export type AgentRunUsage = z.infer<typeof AgentRunUsageSchema>;
export type AgentRunEvent = z.infer<typeof AgentRunEventSchema>;
export type AgentContextStats = z.infer<typeof AgentContextStatsSchema>;
export type AgentRunTrace = z.infer<typeof AgentRunTraceSchema>;
