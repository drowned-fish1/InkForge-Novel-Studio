import type {
  AgentChatSession,
  AgentExtensionConfig,
  AgentSourceReference,
  AgentToolName,
  AgentRunEvent,
  AgentRunTrace,
  BatchRun,
  BackupDiffSummary,
  BackupInspection,
  BackupSettings,
  BackupSnapshot,
  BackupVerification,
  BeatBoard,
  BranchDiffLine,
  ChapterPlan,
  Character,
  Clue,
  Conflict,
  Outline,
  StoryEntityRef,
  StoryReferenceHit,
  PlanningImportResult,
  PlanningImportSelection,
  PlanningPackage,
  PlanningSession,
  ProjectMeta,
  QualityReport,
  ScenePlan,
  SimulationDocument,
  SimulationScenario,
  StoryBranch,
  Term,
  TimelineEvent,
  VolumePlan,
  WorldEntry,
  WritingWorkspace
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
  format: "markdown" | "txt" | "docx" | "epub";
  includeChapterTitles: boolean;
  includeVolumeTitles: boolean;
  epub?: {
    title: string;
    author: string;
    language: string;
    description: string;
    cssTheme: "classic" | "modern";
  };
}

export interface ProviderStatus {
  configured: boolean;
  providerId: string;
  displayName: string;
  baseUrl: string;
  model: string;
  editorModel?: string;
  authMode: ProviderAuthMode;
  maskedKey?: string;
  updatedAt?: string;
}

export interface ProviderPreset {
  id: string;
  displayName: string;
  category: "cloud" | "local" | "gateway";
  description: string;
  baseUrl: string;
  model: string;
  authMode: ProviderAuthMode;
  expectedCapabilities: {
    streaming: boolean;
    tools: boolean;
  };
}

export interface ProviderProbeResult {
  ok: boolean;
  checkedAt: string;
  latencyMs: number;
  modelReachable: boolean;
  capabilities: {
    streaming: boolean;
    tools: boolean;
  };
  message: string;
}

export type ProviderAuthMode = "bearer" | "x-api-key" | "raw-authorization" | "none";

export interface ProviderConfigInput {
  providerId: string;
  displayName: string;
  baseUrl: string;
  model: string;
  editorModel?: string;
  authMode: ProviderAuthMode;
  apiKey?: string;
  temperature: number;
  maxTokens: number;
}

export interface AiTaskInput {
  requestId?: string;
  useEditorModel?: boolean;
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

export interface SaveConflictInput {
  projectPath: string;
  conflict: Conflict;
}

export type { StoryDetachMode, StoryEntityKind, StoryEntityRef, StoryReferenceHit } from "@inkforge/schemas";

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

export interface AgentChatInput {
  requestId?: string;
  projectPath: string;
  chapterId: string;
  message: string;
  replayOfTraceId?: string;
  mode?: "direct" | "plan" | "execute-plan";
  writingApproach?: "stable" | "inspiration" | "compare";
  targetAgentIds?: string[];
  branchId?: string;
  planMessageId?: string;
  context?: {
    tokenBudget?: number;
    includeMemories?: boolean;
    includeSemantic?: boolean;
    pinnedSources?: AgentSourceReference[];
    excludedSourceKeys?: string[];
  };
  limits?: {
    maxTurns?: number;
    maxToolCalls?: number;
    maxTotalTokens?: number;
  };
  allowedTools?: AgentToolName[];
}

export interface AgentSessionCommandInput {
  projectPath: string;
  chapterId: string;
  action: "create-branch" | "select-branch" | "toggle-favorite";
  branchId?: string;
  title?: string;
  messageId?: string;
}

export interface AgentChangeResolutionInput {
  projectPath: string;
  chapterId: string;
  proposalId: string;
  blockId?: string;
  action: "accept-block" | "reject-block" | "apply" | "reject" | "rollback";
}

export interface AgentDataResolutionInput {
  projectPath: string;
  chapterId: string;
  proposalId: string;
  action: "apply" | "reject";
}

export interface CreateStoryBranchInput {
  projectPath: string;
  chapterId: string;
  name: string;
  description?: string;
  content?: string;
  source?: "manual" | "agent" | "batch";
}

export interface SaveStoryBranchInput {
  projectPath: string;
  branchId: string;
  name?: string;
  description?: string;
  content?: string;
}

export interface CreateBatchRunInput {
  projectPath: string;
  chapterIds: string[];
  tokenBudget: number;
  checkpointEvery: number;
  instruction?: string;
}

export interface PlayableExportInput {
  projectPath: string;
  format: "twee" | "ink";
}

export interface SimulationRunInput {
  requestId?: string;
  projectPath: string;
  scenarioId: string;
}

export interface SimulationRunEvent {
  id: string;
  type:
    | "run_started"
    | "branch_started"
    | "turn_completed"
    | "branch_completed"
    | "run_completed"
    | "run_failed"
    | "run_cancelled";
  label: string;
  detail: string;
  timestamp: string;
}

export interface ReleaseReadinessItem {
  id: string;
  label: string;
  status: "ready" | "warning" | "blocked";
  detail: string;
}

export interface ReleaseReadiness {
  checkedAt: string;
  score: number;
  ready: boolean;
  items: ReleaseReadinessItem[];
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
  listBackups: (projectPath: string) => Promise<BackupSnapshot[]>;
  inspectBackups: (projectPath: string) => Promise<BackupInspection>;
  createBackup: (projectPath: string, label?: string) => Promise<BackupSnapshot>;
  restoreBackup: (projectPath: string, snapshotId: string) => Promise<ProjectSummary>;
  deleteBackup: (projectPath: string, snapshotId: string) => Promise<void>;
  verifyBackup: (projectPath: string, snapshotId: string) => Promise<BackupVerification>;
  diffBackup: (projectPath: string, snapshotId: string) => Promise<BackupDiffSummary>;
  readBackupFile: (projectPath: string, snapshotId: string, file: string) => Promise<string>;
  loadBackupSettings: (projectPath: string) => Promise<BackupSettings>;
  saveBackupSettings: (projectPath: string, settings: BackupSettings) => Promise<BackupSettings>;
  chooseBackupDirectory: () => Promise<string | undefined>;
  inspectProjectFolder: (projectPath: string) => Promise<string[]>;
  chooseProjectFolder: () => Promise<string | undefined>;
  listChapterHistoryOverview: (projectPath: string, files: string[]) => Promise<Record<string, ChapterHistoryEntry[]>>;
  loadWritingWorkspace: (projectPath: string) => Promise<WritingWorkspace>;
  saveWritingWorkspace: (projectPath: string, workspace: WritingWorkspace) => Promise<WritingWorkspace>;
  loadAgentExtensions: (projectPath: string) => Promise<AgentExtensionConfig>;
  saveAgentExtensions: (projectPath: string, config: AgentExtensionConfig) => Promise<AgentExtensionConfig>;
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
  listConflicts: (projectPath: string) => Promise<Conflict[]>;
  saveConflict: (input: SaveConflictInput) => Promise<Conflict[]>;
  findEntityReferences: (projectPath: string, target: StoryEntityRef) => Promise<StoryReferenceHit[]>;
  deleteStoryEntity: (
    projectPath: string,
    target: StoryEntityRef,
    mode: "force" | "unlink" | "replace",
    replacement?: string
  ) => Promise<void>;
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
  skipPipelineStep: () => Promise<PipelineRunView>;
  retryPipelineStep: () => Promise<PipelineRunView>;
  runWritingSessionCommand: (input: WritingSessionCommandInput) => Promise<WritingSessionState>;
  loadAgentChat: (projectPath: string, chapterId: string) => Promise<AgentChatSession>;
  runAgentChat: (
    input: AgentChatInput,
    signal?: AbortSignal,
    onEvent?: (event: AgentRunEvent) => void
  ) => Promise<AgentChatSession>;
  cancelAgentChat: (requestId: string) => Promise<void>;
  listAgentTraces: (projectPath: string, chapterId: string) => Promise<AgentRunTrace[]>;
  resolveAgentChange: (input: AgentChangeResolutionInput) => Promise<AgentChatSession>;
  resolveAgentDataChange: (input: AgentDataResolutionInput) => Promise<AgentChatSession>;
  manageAgentSession: (input: AgentSessionCommandInput) => Promise<AgentChatSession>;
  listScenePlans: (projectPath: string, chapterId: string) => Promise<ScenePlan[]>;
  saveScenePlans: (projectPath: string, chapterId: string, scenes: ScenePlan[]) => Promise<ScenePlan[]>;
  evaluateChapterQuality: (projectPath: string, chapterId: string) => Promise<QualityReport>;
  listChapterQualityReports: (projectPath: string, chapterId: string) => Promise<QualityReport[]>;
  setChapterQualityBaseline: (projectPath: string, chapterId: string, reportId: string) => Promise<QualityReport>;
  listStoryBranches: (projectPath: string, chapterId?: string) => Promise<StoryBranch[]>;
  createStoryBranch: (input: CreateStoryBranchInput) => Promise<StoryBranch>;
  saveStoryBranch: (input: SaveStoryBranchInput) => Promise<StoryBranch>;
  compareStoryBranch: (projectPath: string, branchId: string) => Promise<BranchDiffLine[]>;
  applyStoryBranch: (projectPath: string, branchId: string) => Promise<StoryBranch>;
  archiveStoryBranch: (projectPath: string, branchId: string) => Promise<StoryBranch>;
  listBatchRuns: (projectPath: string) => Promise<BatchRun[]>;
  createBatchRun: (input: CreateBatchRunInput) => Promise<BatchRun>;
  resumeBatchRun: (projectPath: string, runId: string) => Promise<BatchRun>;
  cancelBatchRun: (projectPath: string, runId: string) => Promise<BatchRun>;
  listProviderPresets: () => Promise<ProviderPreset[]>;
  probeProvider: () => Promise<ProviderProbeResult>;
  getReleaseReadiness: (projectPath: string) => Promise<ReleaseReadiness>;
  loadBeatBoard: (projectPath: string) => Promise<BeatBoard>;
  saveBeatBoard: (projectPath: string, board: BeatBoard) => Promise<BeatBoard>;
  exportPlayable: (input: PlayableExportInput) => Promise<string | undefined>;
  listSimulations: (projectPath: string) => Promise<SimulationDocument[]>;
  saveSimulationScenario: (projectPath: string, scenario: SimulationScenario) => Promise<SimulationDocument>;
  runSimulation: (
    input: SimulationRunInput,
    signal?: AbortSignal,
    onEvent?: (event: SimulationRunEvent) => void
  ) => Promise<SimulationDocument>;
  cancelSimulation: (requestId: string) => Promise<void>;
}

export type {
  WritingScene,
  WritingSessionState,
  PlanningImportResult,
  PlanningImportSelection,
  PlanningPackage,
  PlanningSession,
  AgentChatSession,
  AgentRunEvent,
  AgentRunTrace
};
