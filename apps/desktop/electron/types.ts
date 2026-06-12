import type {
  ChapterPlan,
  Character,
  Clue,
  Outline,
  PlanningImportResult,
  PlanningImportSelection,
  PlanningPackage,
  PlanningSession,
  ProjectMeta,
  Term,
  TimelineEvent,
  VolumePlan,
  WorldEntry
} from "@inkforge/schemas";
import type { WritingScene, WritingSessionState } from "@inkforge/agent-engine";

export interface ProjectSummary {
  projectPath: string;
  meta: ProjectMeta;
  outline: Outline;
}

export interface ProjectListItem {
  projectPath: string;
  title: string;
  updatedAt: string;
  chapterCount: number;
}

export interface CreateProjectInput {
  title: string;
  author: string;
  genre: string[];
  targetWords: number;
  style: string;
  protagonist: string;
  premise: string;
}

export interface ChapterContent {
  chapter: ChapterPlan;
  content: string;
}

export interface SaveChapterInput {
  projectPath: string;
  file: string;
  content: string;
}

export interface ChapterHistoryEntry {
  id: string;
  createdAt: string;
  size: number;
}

export interface CreateChapterInput {
  projectPath: string;
  volumeId: string;
  title?: string;
}

export interface UpdateChapterPlanInput {
  projectPath: string;
  chapterId: string;
  patch: Partial<
    Pick<
      ChapterPlan,
      | "title"
      | "goal"
      | "hook"
      | "status"
      | "targetWords"
      | "actualWords"
      | "notes"
      | "conflictPoints"
      | "characters"
      | "worldRefs"
      | "archived"
    >
  >;
}

export interface DeleteChapterInput {
  projectPath: string;
  chapterId: string;
  deleteFile: boolean;
}

export interface MoveChapterInput {
  projectPath: string;
  chapterId: string;
  toVolumeId: string;
  toIndex: number;
}

export interface CreateVolumeInput {
  projectPath: string;
  title?: string;
}

export interface UpdateVolumeInput {
  projectPath: string;
  volumeId: string;
  patch: Partial<Pick<VolumePlan, "title" | "goal" | "targetWords">>;
}

export interface DeleteVolumeInput {
  projectPath: string;
  volumeId: string;
  deleteFiles: boolean;
}

export interface UpdateOutlineInput {
  projectPath: string;
  outline: Outline;
}

export interface ExportInput {
  projectPath: string;
  format: "markdown" | "txt" | "docx";
  includeChapterTitles: boolean;
  includeVolumeTitles: boolean;
}

export interface ProviderStatus {
  configured: boolean;
  providerId: string;
  displayName: string;
  baseUrl: string;
  model: string;
  authMode: ProviderAuthMode;
  maskedKey?: string;
  updatedAt?: string;
}

export type ProviderAuthMode = "bearer" | "x-api-key" | "raw-authorization" | "none";

export interface ProviderConfigInput {
  providerId: string;
  displayName: string;
  baseUrl: string;
  model: string;
  authMode: ProviderAuthMode;
  apiKey?: string;
  temperature: number;
  maxTokens: number;
}

export interface AiTaskInput {
  requestId?: string;
  projectPath: string;
  task:
    | "continue"
    | "expand"
    | "rewrite"
    | "dialogue"
    | "action"
    | "summary"
    | "next-goal"
    | "pacing"
    | "character-state"
    | "clue-check"
    | "term-check"
    | "polish"
    | "typo"
    | "pre-export"
    | "ai-inspect";
  instruction?: string;
  chapterTitle: string;
  chapterGoal: string;
  recentText: string;
  characters: string[];
  worldFacts: string[];
  style: string;
}

export interface AiTaskResult {
  task: AiTaskInput["task"];
  text: string;
  providerId: string;
  model: string;
  contextSummary: string;
  generatedAt: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export interface SaveChapterSummaryInput {
  projectPath: string;
  chapterId: string;
  chapterTitle: string;
  result: AiTaskResult;
}

export interface SaveCharacterInput {
  projectPath: string;
  character: Character;
}

export interface SaveWorldEntryInput {
  projectPath: string;
  entry: WorldEntry;
}

export interface SaveTimelineEventInput {
  projectPath: string;
  event: TimelineEvent;
}

export interface SaveClueInput {
  projectPath: string;
  clue: Clue;
}

export interface SaveTermInput {
  projectPath: string;
  term: Term;
}

export interface ConsistencyIssue {
  id: string;
  severity: "info" | "warning" | "error";
  scope: "timeline" | "clue" | "term" | "project";
  title: string;
  detail: string;
}

export interface PlanningAiInput {
  requestId?: string;
  projectPath: string;
  sessionId: string;
  mode: "questions" | "package";
  userMessage?: string;
}

export type PipelineRunStatus = "idle" | "running" | "paused" | "failed" | "completed" | "cancelled";

export interface PipelinePresetSummary {
  id: string;
  name: string;
  description: string;
  autoCommit: boolean;
  stopOnError: boolean;
  steps: Array<{
    id: string;
    title: string;
  }>;
}

export interface PipelineStepView {
  id: string;
  title: string;
  status: "pending" | "running" | "completed" | "paused" | "failed" | "skipped";
  outputSummary?: string;
  error?: string;
}

export interface PipelineRunView {
  id: string;
  presetId: string;
  status: PipelineRunStatus;
  currentStepId?: string;
  pendingStepId?: string;
  startedAt: string;
  completedAt?: string;
  steps: PipelineStepView[];
  logs: string[];
  outputs: Record<string, unknown>;
  error?: string;
}

export interface PipelineStartInput {
  presetId: string;
  projectPath?: string;
  chapterId?: string;
  autoCommit?: boolean;
}

export type WritingSessionCommand =
  | "start"
  | "pause"
  | "resume"
  | "stop"
  | "checkpoint"
  | "rollback"
  | "resolveDecision";

export interface WritingSessionCommandInput {
  command: WritingSessionCommand;
  sessionId?: string;
  scenes?: WritingScene[];
  checkpointId?: string;
  checkpointLabel?: string;
  decision?: string;
}

export interface InkforgeApi {
  setTheme: (theme: "light" | "dark", manual?: boolean) => Promise<void>;
  listProjects: () => Promise<ProjectListItem[]>;
  createProject: (input: CreateProjectInput) => Promise<ProjectSummary | undefined>;
  openProject: (projectPath?: string) => Promise<ProjectSummary | undefined>;
  importProjectFolder: () => Promise<ProjectSummary | undefined>;
  revealProject: (projectPath?: string) => Promise<void>;
  readChapter: (projectPath: string, file: string) => Promise<string>;
  saveChapter: (input: SaveChapterInput) => Promise<void>;
  listChapterHistory: (projectPath: string, file: string) => Promise<ChapterHistoryEntry[]>;
  readChapterHistory: (projectPath: string, file: string, historyId: string) => Promise<string>;
  restoreChapterHistory: (projectPath: string, file: string, historyId: string) => Promise<string>;
  createChapter: (input: CreateChapterInput) => Promise<ProjectSummary>;
  updateOutline: (input: UpdateOutlineInput) => Promise<ProjectSummary>;
  exportManuscript: (input: ExportInput) => Promise<string | undefined>;
  listCharacters: (projectPath: string) => Promise<Character[]>;
  saveCharacter: (input: SaveCharacterInput) => Promise<Character[]>;
  listWorldEntries: (projectPath: string) => Promise<WorldEntry[]>;
  saveWorldEntry: (input: SaveWorldEntryInput) => Promise<WorldEntry[]>;
  providerStatus: () => Promise<ProviderStatus>;
  saveProviderConfig: (input: ProviderConfigInput) => Promise<ProviderStatus>;
  runAiTask: (input: AiTaskInput, signal?: AbortSignal, onDelta?: (chunk: string) => void) => Promise<AiTaskResult>;
  cancelAiTask: (requestId: string) => Promise<void>;
  saveChapterSummary: (input: SaveChapterSummaryInput) => Promise<string>;
  listChapterSummaries: (projectPath: string) => Promise<
    Array<{
      id: string;
      chapterId: string;
      chapterTitle: string;
      task: string;
      model: string;
      savedAt: string;
      snippet: string;
    }>
  >;
  listTimeline: (projectPath: string) => Promise<TimelineEvent[]>;
  saveTimelineEvent: (input: SaveTimelineEventInput) => Promise<TimelineEvent[]>;
  listClues: (projectPath: string) => Promise<Clue[]>;
  saveClue: (input: SaveClueInput) => Promise<Clue[]>;
  listTerms: (projectPath: string) => Promise<Term[]>;
  saveTerm: (input: SaveTermInput) => Promise<Term[]>;
  inspectStory: (projectPath: string) => Promise<ConsistencyIssue[]>;
  listPlanningSessions: (projectPath: string) => Promise<PlanningSession[]>;
  savePlanningSession: (projectPath: string, session: PlanningSession) => Promise<PlanningSession[]>;
  runPlanningAi: (input: PlanningAiInput, signal?: AbortSignal) => Promise<PlanningSession>;
  cancelPlanningAi: (requestId: string) => Promise<void>;
  importPlanningPackage: (
    projectPath: string,
    sessionId: string,
    selection: PlanningImportSelection
  ) => Promise<PlanningImportResult>;
  restorePlanningSnapshot: (projectPath: string, snapshotId: string) => Promise<PlanningImportResult>;
  listPipelinePresets: () => Promise<PipelinePresetSummary[]>;
  startPipeline: (input: PipelineStartInput) => Promise<PipelineRunView>;
  confirmPipelineStep: () => Promise<PipelineRunView>;
  pausePipeline: () => Promise<PipelineRunView>;
  cancelPipeline: () => Promise<PipelineRunView>;
  runWritingSessionCommand: (input: WritingSessionCommandInput) => Promise<WritingSessionState>;
}

export type {
  WritingScene,
  WritingSessionState,
  PlanningImportResult,
  PlanningImportSelection,
  PlanningPackage,
  PlanningSession
};
