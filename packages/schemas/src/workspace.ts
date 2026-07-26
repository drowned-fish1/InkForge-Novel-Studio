import { z } from "zod";
import { AgentToolNameSchema } from "./agent.js";

export const BackupSnapshotSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string(),
  reason: z.enum(["automatic", "manual", "before-restore"]),
  label: z.string().default(""),
  fileCount: z.number().int().nonnegative(),
  size: z.number().int().nonnegative(),
  chapterHashes: z.record(z.string(), z.string()).default({}),
  changedChapterFiles: z.array(z.string()).default([])
});

export const BackupSettingsSchema = z.object({
  automaticIntervalMinutes: z.number().int().min(1).max(1440).default(10),
  maxAutomaticSnapshots: z.number().int().min(1).max(200).default(20),
  maxTotalSizeMb: z.number().int().min(10).max(102400).default(512),
  backupDirectory: z.string().default("")
});

export const BackupInspectionSchema = z.object({
  snapshots: z.array(BackupSnapshotSchema).default([]),
  corrupted: z.array(z.string()).default([]),
  totalSize: z.number().int().nonnegative().default(0),
  backupRoot: z.string().default("")
});

export const BackupVerificationSchema = z.object({
  snapshotId: z.string().min(1),
  ok: z.boolean(),
  checkedFiles: z.number().int().nonnegative().default(0),
  issues: z.array(z.string()).default([])
});

export const BackupDiffSummarySchema = z.object({
  snapshotId: z.string().min(1),
  addedChapters: z.array(z.string()).default([]),
  removedChapters: z.array(z.string()).default([]),
  modifiedChapters: z.array(z.string()).default([]),
  changedMetaFiles: z.array(z.string()).default([])
});

export const WritingAnnotationSchema = z.object({
  id: z.string().min(1),
  chapterId: z.string().min(1),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  quote: z.string().default(""),
  note: z.string().default(""),
  color: z.enum(["green", "amber", "rose"]).default("green"),
  kind: z.enum(["comment", "revision"]).default("comment"),
  status: z.enum(["open", "resolved", "deferred"]).default("open"),
  createdAt: z.string()
});

export const WritingBookmarkSchema = z.object({
  id: z.string().min(1),
  chapterId: z.string().min(1),
  offset: z.number().int().nonnegative(),
  label: z.string().default(""),
  createdAt: z.string()
});

export const WritingSessionRecordSchema = z.object({
  id: z.string().min(1),
  chapterId: z.string().min(1),
  startedAt: z.string(),
  endedAt: z.string(),
  wordsAdded: z.number().int(),
  durationSeconds: z.number().int().nonnegative()
});

export const InspirationFragmentSchema = z.object({
  id: z.string().min(1),
  title: z.string().default(""),
  content: z.string().default(""),
  tags: z.array(z.string()).default([]),
  archived: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const WritingWorkspaceSchema = z.object({
  annotations: z.array(WritingAnnotationSchema).default([]),
  bookmarks: z.array(WritingBookmarkSchema).default([]),
  sessions: z.array(WritingSessionRecordSchema).default([]),
  fragments: z.array(InspirationFragmentSchema).default([])
});

export const AgentPromptPresetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  prompt: z.string().min(1),
  builtIn: z.boolean().default(false)
});

export const AgentToolProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  allowedTools: z.array(AgentToolNameSchema).default([]),
  maxTurns: z.number().int().positive().max(30).default(8),
  maxToolCalls: z.number().int().positive().max(60).default(16),
  maxTotalTokens: z.number().int().positive().max(200000).default(24000)
});

export const AgentCustomToolSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  instruction: z.string().min(1),
  allowedTools: z.array(AgentToolNameSchema).default([])
});

export const AgentMemberSchema = z.object({
  id: z.string().min(1),
  handle: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
  prompt: z.string().min(1),
  model: z.string().default(""),
  allowedTools: z.array(AgentToolNameSchema).default([...AgentToolNameSchema.options]),
  color: z.enum(["green", "amber", "blue", "rose", "slate"]).default("slate"),
  builtIn: z.boolean().default(false),
  enabled: z.boolean().default(true)
});

export const defaultAgentMembers = AgentMemberSchema.array().parse([
  {
    id: "director",
    handle: "导演",
    name: "导演 Agent",
    role: "结构与场景调度",
    prompt: "关注场景目的、因果、信息释放、冲突升级和章节结构；不代替作家堆砌正文。",
    allowedTools: [
      "get_chapter_context",
      "get_chapter_memory",
      "get_outline_context",
      "get_story_bible",
      "get_narrative_board",
      "get_simulation_runs",
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
    ],
    color: "amber",
    builtIn: true
  },
  {
    id: "writer",
    handle: "作家",
    name: "作家 Agent",
    role: "正文创作",
    prompt: "负责视角内正文、人物行动和语言实现；遵守大纲、硬事实与作者已确认的风格。",
    allowedTools: [
      "get_chapter_context",
      "get_chapter_memory",
      "get_outline_context",
      "get_story_bible",
      "get_narrative_board",
      "get_simulation_runs",
      "semantic_search",
      "propose_chapter_edit",
      "propose_chapter_patch",
      "propose_scene_plan"
    ],
    color: "green",
    builtIn: true
  },
  {
    id: "editor",
    handle: "编辑",
    name: "编辑 Agent",
    role: "文学审稿与修剪",
    prompt: "优先发现模板表达、解释过量、零价值过渡、节奏拖沓和视角越界；默认只提出局部修改。",
    allowedTools: [
      "get_chapter_context",
      "get_chapter_memory",
      "get_outline_context",
      "get_narrative_board",
      "inspect_continuity",
      "propose_chapter_edit",
      "propose_chapter_patch"
    ],
    color: "rose",
    builtIn: true
  },
  {
    id: "librarian",
    handle: "资料员",
    name: "资料员 Agent",
    role: "事实与连续性",
    prompt: "优先读取大纲、人物、世界观、时间线和章节记忆；区分已确认事实、推断与未知。",
    allowedTools: [
      "get_chapter_context",
      "get_chapter_memory",
      "get_outline_context",
      "get_story_bible",
      "get_narrative_board",
      "get_simulation_runs",
      "semantic_search",
      "inspect_continuity",
      "propose_outline_update",
      "propose_character_update",
      "propose_world_update",
      "propose_clue_update",
      "propose_term_update",
      "propose_timeline_event",
      "propose_beat_update"
    ],
    color: "blue",
    builtIn: true
  }
]);

export const AgentExtensionConfigSchema = z.object({
  promptPresets: z.array(AgentPromptPresetSchema).default([]),
  toolProfiles: z.array(AgentToolProfileSchema).default([]),
  customTools: z.array(AgentCustomToolSchema).default([]),
  members: z.array(AgentMemberSchema).default(defaultAgentMembers)
});

export type BackupSnapshot = z.infer<typeof BackupSnapshotSchema>;
export type BackupSettings = z.infer<typeof BackupSettingsSchema>;
export type BackupInspection = z.infer<typeof BackupInspectionSchema>;
export type BackupVerification = z.infer<typeof BackupVerificationSchema>;
export type BackupDiffSummary = z.infer<typeof BackupDiffSummarySchema>;
export type InspirationFragment = z.infer<typeof InspirationFragmentSchema>;
export type WritingAnnotation = z.infer<typeof WritingAnnotationSchema>;
export type WritingBookmark = z.infer<typeof WritingBookmarkSchema>;
export type WritingSessionRecord = z.infer<typeof WritingSessionRecordSchema>;
export type WritingWorkspace = z.infer<typeof WritingWorkspaceSchema>;
export type AgentPromptPreset = z.infer<typeof AgentPromptPresetSchema>;
export type AgentToolProfile = z.infer<typeof AgentToolProfileSchema>;
export type AgentCustomTool = z.infer<typeof AgentCustomToolSchema>;
export type AgentMember = z.infer<typeof AgentMemberSchema>;
export type AgentExtensionConfig = z.infer<typeof AgentExtensionConfigSchema>;
