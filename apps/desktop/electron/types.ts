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
  ExportConfig,
  ExportPreflightIssue,
  Outline,
  Pipeline,
  QualityFinding,
  RevisionState,
  StoryEntityRef,
  StoryReferenceHit,
  WritingAnnotation,
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
import type {
  AnalysisJob,
  AnalysisJobInput,
  CorpusImportInput,
  CorpusImportManifest,
  ImportProgress
} from "./services/ContinuationTypes.js";
import type { AdoptCorpusInput, CorpusAdoptionResult } from "./services/CorpusAdoptionService.js";
import type { ChunkIndexStats, ChunkIndexUpdateResult, IndexChapterInput } from "./services/ChunkIndexService.js";
import type { HybridRetrieveOptions, HybridSearchResult } from "./services/HybridRetriever.js";
import type { CanonFactFilter } from "./services/CanonStore.js";
import type { StoryThreadFilter } from "./services/StoryThreadService.js";
import type { CompileContextInput } from "./services/ContextCompiler.js";
import type { StyleEvaluationResult, StyleProfileBuildResult } from "./services/StyleProfileService.js";
import type {
  ContinuationRun,
  ContinuationRunInput,
  ContinuationRunResult,
  ContinuationRetryInput
} from "./services/ContinuationOrchestrator.js";

/** Renderer-safe import request (progress handlers never cross the IPC boundary). */
export type CorpusImportRequest = Omit<CorpusImportInput, "onProgress">;

/** Renderer-safe analysis request (progress handlers never cross the IPC boundary). */
export type AnalysisJobRequest = Omit<AnalysisJobInput, "onProgress">;

export interface ContinuationProgressHandlers {
  onProgress?: (progress: ImportProgress | import("./services/ContinuationTypes.js").AnalysisProgress) => void;
}

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
    publisher?: string;
    copyright?: string;
    coverImagePath?: string;
    lineHeight?: number;
    paragraphIndent?: boolean;
    volumeTitlePages?: boolean;
  };
}

export type { ProviderStatus, ProviderConfigInput, ProviderAuthMode } from "@inkforge/ai-provider";
import type { ProviderStatus, ProviderConfigInput, ProviderRole, ProviderAuthMode } from "@inkforge/ai-provider";

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
    streaming?: boolean;
    tools: boolean;
  };
  providerRole?: ProviderRole;
  model?: string;
  message: string;
}

export interface AiTaskInput {
  chapterId?: string;
  providerRole?: ProviderRole;
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
    | "character-generate"
    | "character-names"
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

export interface QualitySweepEntry {
  chapterId: string;
  chapterTitle: string;
  wordCount: number;
  overallScore: number;
  baselineDelta?: number;
  warningCount: number;
  infoCount: number;
  topFinding?: string;
}

export interface QualitySweepResult {
  generatedAt: string;
  chapterCount: number;
  averageScore: number;
  continuityIssueCount: number;
  entries: QualitySweepEntry[];
}

export interface ProjectSearchResult {
  kind: "chapter" | "character" | "world" | "location" | "faction" | "conflict" | "clue" | "term" | "event";
  id: string;
  title: string;
  volumeTitle?: string;
  offset: number;
  matchLength: number;
  snippet: string;
}

export interface RevisionProposalSummary {
  id: string;
  chapterId: string;
  chapterTitle: string;
  kind: "change" | "data";
  mode?: "append" | "replace" | "patch";
  entityType?: string;
  title: string;
  explanation: string;
  createdAt: string;
  blockCount: number;
  contentPreview: string;
}

export interface RevisionOverview {
  annotations: Array<WritingAnnotation & { chapterTitle: string }>;
  qualityReports: Array<{
    chapterId: string;
    chapterTitle: string;
    overallScore: number;
    baselineDelta?: number;
    createdAt: string;
    findings: QualityFinding[];
  }>;
  continuityIssues: ConsistencyIssue[];
  proposals: RevisionProposalSummary[];
  revisionState: RevisionState;
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
  /** Custom workflow template (imported via agent extensions); steps run by kind. */
  customPipeline?: Pipeline;
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
  yolo?: boolean;
  updateProjectData?: boolean;
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
  askBeforeTools?: AgentToolName[];
}

export interface AgentRunEstimate {
  estimated: true;
  promptTokens: number;
  maxCompletionTokens: number;
  contextTokens: number;
  historyTokens: number;
  messageTokens: number;
  estimatedCost?: number;
  currency?: string;
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
  expectedBaseContent?: string;
  updateProjectData?: boolean;
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

export interface UpdateStatus {
  phase: "disabled" | "idle" | "checking" | "available" | "not-available" | "downloading" | "downloaded" | "error";
  configured: boolean;
  currentVersion: string;
  availableVersion?: string;
  downloadPercent?: number;
  message: string;
}

export type CorpusImportStartInput = CorpusImportRequest;
export type AnalysisJobStartInput = AnalysisJobRequest;

/** Inputs used by the incremental chapter indexer. */
export interface IndexProjectInput {
  projectPath: string;
  chapters: IndexChapterInput[];
}

export interface ContinuationIndexStats extends ChunkIndexStats {
  /** UI-friendly aliases retained alongside the service's concise names. */
  chapterCount: number;
  chunkCount: number;
}

export interface SaveCanonFactInput {
  projectPath: string;
  fact: import("@inkforge/schemas").CanonFact;
}

export interface SaveStoryThreadInput {
  projectPath: string;
  thread: import("@inkforge/schemas").StoryThread;
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
  loadExportConfig: (projectPath: string) => Promise<ExportConfig>;
  saveExportConfig: (projectPath: string, config: ExportConfig) => Promise<ExportConfig>;
  exportPreflight: (projectPath: string) => Promise<ExportPreflightIssue[]>;
  chooseCoverImage: () => Promise<string | undefined>;
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
  searchProject: (projectPath: string, query: string) => Promise<ProjectSearchResult[]>;
  revisionOverview: (projectPath: string) => Promise<RevisionOverview>;
  setRevisionDisposition: (
    projectPath: string,
    key: string,
    status: "open" | "accepted" | "ignored" | "deferred",
    note?: string
  ) => Promise<RevisionState>;
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
  estimateAgentRun: (
    input: Pick<AgentChatInput, "projectPath" | "chapterId" | "message" | "context" | "limits">
  ) => Promise<AgentRunEstimate>;
  approveAgentTool: (requestId: string, callId: string, approved: boolean) => Promise<void>;
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
  evaluateProjectQuality: (projectPath: string) => Promise<QualitySweepResult>;
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
  probeProvider: (role?: ProviderRole) => Promise<ProviderProbeResult>;
  getReleaseReadiness: (projectPath: string) => Promise<ReleaseReadiness>;
  getUpdateStatus: () => Promise<UpdateStatus>;
  checkForUpdates: () => Promise<UpdateStatus>;
  downloadUpdate: () => Promise<UpdateStatus>;
  installUpdate: () => Promise<boolean>;
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

  /** Long-novel continuation corpus lifecycle. */
  chooseCorpusSource: () => Promise<string | undefined>;
  startCorpusImport: (
    input: CorpusImportStartInput,
    onProgress?: (progress: ImportProgress) => void
  ) => Promise<CorpusImportManifest>;
  listCorpusImports: (projectPath: string) => Promise<CorpusImportManifest[]>;
  pauseCorpusImport: (projectPath: string, importId: string) => Promise<CorpusImportManifest>;
  resumeCorpusImport: (
    projectPath: string,
    importId: string,
    onProgress?: (progress: ImportProgress) => void
  ) => Promise<CorpusImportManifest>;
  cancelCorpusImport: (projectPath: string, importId: string) => Promise<CorpusImportManifest>;
  adoptCorpusImport: (input: AdoptCorpusInput) => Promise<CorpusAdoptionResult>;

  /** Durable chapter-at-a-time analysis lifecycle. */
  startAnalysisJob: (
    input: AnalysisJobStartInput,
    onProgress?: (progress: import("./services/ContinuationTypes.js").AnalysisProgress) => void
  ) => Promise<AnalysisJob>;
  listAnalysisJobs: (projectPath: string) => Promise<AnalysisJob[]>;
  pauseAnalysisJob: (projectPath: string, jobId: string) => Promise<AnalysisJob>;
  resumeAnalysisJob: (
    projectPath: string,
    jobId: string,
    onProgress?: (progress: import("./services/ContinuationTypes.js").AnalysisProgress) => void
  ) => Promise<AnalysisJob>;
  cancelAnalysisJob: (projectPath: string, jobId: string) => Promise<AnalysisJob>;

  /** Incremental retrieval index. */
  indexChapter: (projectPath: string, input: IndexChapterInput) => Promise<ChunkIndexUpdateResult>;
  indexProject: {
    (input: IndexProjectInput): Promise<ChunkIndexUpdateResult[]>;
    (projectPath: string): Promise<ChunkIndexUpdateResult[]>;
  };
  getChunkIndexStats: (projectPath: string) => Promise<ContinuationIndexStats>;
  searchContinuation: (
    projectPath: string,
    query: string,
    options?: HybridRetrieveOptions
  ) => Promise<HybridSearchResult>;

  /** Author-reviewed canon facts and long-running story threads. */
  listCanonFacts: (projectPath: string, filter?: CanonFactFilter) => Promise<import("@inkforge/schemas").CanonFact[]>;
  saveCanonFact: {
    (input: SaveCanonFactInput): Promise<import("@inkforge/schemas").CanonFact>;
    (projectPath: string, fact: import("@inkforge/schemas").CanonFact): Promise<import("@inkforge/schemas").CanonFact>;
  };
  setCanonFactStatus: (
    projectPath: string,
    factId: string,
    status: import("@inkforge/schemas").CanonFactStatus
  ) => Promise<import("@inkforge/schemas").CanonFact>;
  listStoryThreads: (
    projectPath: string,
    filter?: StoryThreadFilter
  ) => Promise<import("@inkforge/schemas").StoryThread[]>;
  saveStoryThread: {
    (input: SaveStoryThreadInput): Promise<import("@inkforge/schemas").StoryThread>;
    (
      projectPath: string,
      thread: import("@inkforge/schemas").StoryThread
    ): Promise<import("@inkforge/schemas").StoryThread>;
  };
  setStoryThreadStatus: (
    projectPath: string,
    threadId: string,
    status: import("@inkforge/schemas").StoryThreadStatus
  ) => Promise<import("@inkforge/schemas").StoryThread>;

  /** Measurable prose style profile and bounded evidence compilation. */
  analyzeStyleProfile: (
    projectPath: string,
    options?: { chapterIds?: string[]; maxExemplarsPerType?: number }
  ) => Promise<StyleProfileBuildResult>;
  loadStyleProfile: (projectPath: string) => Promise<import("@inkforge/schemas").StyleProfile | undefined>;
  evaluateStyle: (projectPath: string, text: string, tolerance?: number) => Promise<StyleEvaluationResult>;
  compileContinuationContext: (input: CompileContextInput) => Promise<import("@inkforge/schemas").EvidencePack>;
  /** Continuation orchestration is wired by the main process when available. */
  listContinuationRuns: (projectPath: string, chapterId?: string) => Promise<ContinuationRun[]>;
  startContinuationRun: (input: ContinuationRunInput) => Promise<ContinuationRunResult>;
  retryContinuationRun: (
    projectPath: string,
    runId: string,
    options?: ContinuationRetryInput
  ) => Promise<ContinuationRunResult>;
  cancelContinuationRun: (projectPath: string, runId: string) => Promise<ContinuationRun>;
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

export type {
  AnalysisJob,
  AnalysisJobInput,
  CorpusImportInput,
  CorpusImportManifest,
  ImportProgress,
  AdoptCorpusInput,
  CorpusAdoptionResult,
  ChunkIndexStats,
  ChunkIndexUpdateResult,
  IndexChapterInput,
  HybridRetrieveOptions,
  HybridSearchResult,
  CanonFactFilter,
  StoryThreadFilter,
  CompileContextInput,
  StyleEvaluationResult,
  StyleProfileBuildResult,
  ContinuationRun,
  ContinuationRunInput,
  ContinuationRunResult,
  ContinuationRetryInput
};
