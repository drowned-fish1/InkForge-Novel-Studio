import { z } from "zod";

export const QualityDimensionSchema = z.enum(["continuity", "character", "pacing", "style", "repetition", "clue"]);

export const QualityDimensionScoresSchema = z.object({
  continuity: z.number().min(0).max(100),
  character: z.number().min(0).max(100),
  pacing: z.number().min(0).max(100),
  style: z.number().min(0).max(100),
  repetition: z.number().min(0).max(100),
  clue: z.number().min(0).max(100)
});

export const QualityFindingSchema = z.object({
  id: z.string().min(1),
  dimension: QualityDimensionSchema,
  severity: z.enum(["info", "warning", "error"]),
  title: z.string().min(1),
  detail: z.string().default(""),
  evidence: z.string().default(""),
  suggestion: z.string().default("")
});

export const QualityReportSchema = z.object({
  schemaVersion: z.literal("0.1.0").default("0.1.0"),
  id: z.string().min(1),
  chapterId: z.string().min(1),
  chapterTitle: z.string().default(""),
  createdAt: z.string(),
  fingerprint: z.string().min(1),
  wordCount: z.number().int().nonnegative(),
  overallScore: z.number().min(0).max(100),
  dimensionScores: QualityDimensionScoresSchema,
  findings: z.array(QualityFindingSchema).default([]),
  baselineDelta: z.number().optional()
});

export const QualityBaselineSchema = z.object({
  schemaVersion: z.literal("0.1.0").default("0.1.0"),
  reportId: z.string().min(1),
  chapterId: z.string().min(1),
  createdAt: z.string(),
  overallScore: z.number().min(0).max(100),
  dimensionScores: QualityDimensionScoresSchema
});

export const StoryBranchSchema = z.object({
  schemaVersion: z.literal("0.1.0").default("0.1.0"),
  id: z.string().min(1),
  chapterId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  baseFingerprint: z.string().min(1),
  baseContent: z.string().default(""),
  content: z.string().default(""),
  status: z.enum(["draft", "applied", "archived"]).default("draft"),
  source: z.enum(["manual", "agent", "batch"]).default("manual"),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const BranchDiffLineSchema = z.object({
  kind: z.enum(["context", "add", "remove"]),
  text: z.string()
});

export const BatchTaskSchema = z.object({
  id: z.string().min(1),
  chapterId: z.string().min(1),
  chapterTitle: z.string().min(1),
  status: z.enum(["queued", "running", "completed", "failed", "cancelled"]).default("queued"),
  estimatedTokens: z.number().int().nonnegative().default(0),
  actualTokens: z.number().int().nonnegative().default(0),
  branchId: z.string().optional(),
  qualityScore: z.number().min(0).max(100).optional(),
  error: z.string().default("")
});

export const BatchRunSchema = z.object({
  schemaVersion: z.literal("0.1.0").default("0.1.0"),
  id: z.string().min(1),
  status: z.enum(["draft", "running", "paused", "completed", "cancelled", "failed"]).default("draft"),
  tasks: z.array(BatchTaskSchema).min(1),
  tokenBudget: z.number().int().positive(),
  usedTokens: z.number().int().nonnegative().default(0),
  checkpointEvery: z.number().int().positive().default(1),
  completedSinceCheckpoint: z.number().int().nonnegative().default(0),
  createdAt: z.string(),
  updatedAt: z.string(),
  logs: z.array(z.string()).default([])
});

export type QualityDimension = z.infer<typeof QualityDimensionSchema>;
export type QualityDimensionScores = z.infer<typeof QualityDimensionScoresSchema>;
export type QualityFinding = z.infer<typeof QualityFindingSchema>;
export type QualityReport = z.infer<typeof QualityReportSchema>;
export type QualityBaseline = z.infer<typeof QualityBaselineSchema>;
export type StoryBranch = z.infer<typeof StoryBranchSchema>;
export type BranchDiffLine = z.infer<typeof BranchDiffLineSchema>;
export type BatchTask = z.infer<typeof BatchTaskSchema>;
export type BatchRun = z.infer<typeof BatchRunSchema>;
