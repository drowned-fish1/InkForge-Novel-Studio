import { z } from "zod";
import { ProjectDataEntrySchema } from "./project-data.js";
import type { Clue } from "./index.js";

/** Values that can be asserted by the continuity engine. */
export const CanonValueSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.array(z.string())]);

export type CanonValue = z.infer<typeof CanonValueSchema>;

export const CanonFactStatusSchema = z.enum(["candidate", "confirmed", "author_locked", "conflicted", "rejected"]);

export type CanonFactStatus = z.infer<typeof CanonFactStatusSchema>;

/** A stable pointer back into the immutable source text. */
export const EvidenceRefSchema = z
  .object({
    chapterId: z.string().trim().min(1),
    sceneId: z.string().trim().min(1).optional(),
    startOffset: z.number().int().nonnegative(),
    endOffset: z.number().int().nonnegative(),
    excerpt: z.string().min(1),
    contentHash: z.string().trim().min(1)
  })
  .superRefine((value, context) => {
    if (value.endOffset < value.startOffset) {
      context.addIssue({
        code: "custom",
        path: ["endOffset"],
        message: "endOffset must be greater than or equal to startOffset"
      });
    }
  });

export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;

/**
 * An author-facing fact. A fact is never considered hard canon without at
 * least one source pointer; candidates may be saved before review.
 */
export const CanonFactSchema = z
  .object({
    id: z.string().trim().min(1),
    subjectId: z.string().trim().min(1),
    predicate: z.string().trim().min(1),
    objectValue: CanonValueSchema,
    validFromChapterId: z.string().trim().min(1).optional(),
    validToChapterId: z.string().trim().min(1).optional(),
    certainty: z.number().finite().min(0).max(1).default(0.5),
    status: CanonFactStatusSchema.default("candidate"),
    evidence: z.array(EvidenceRefSchema).default([]),
    supersedes: z.array(z.string().trim().min(1)).default([]),
    source: z.enum(["author", "extraction", "migration", "import"]).default("extraction"),
    notes: z.string().default(""),
    createdAt: z.string().datetime({ offset: true }).optional(),
    updatedAt: z.string().datetime({ offset: true }).optional()
  })
  .superRefine((value, context) => {
    if ((value.status === "confirmed" || value.status === "author_locked") && value.evidence.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["evidence"],
        message: "Confirmed and author-locked facts require at least one evidence reference"
      });
    }
  });

export type CanonFact = z.infer<typeof CanonFactSchema>;

/** A point-in-time change used to reconstruct a subject's state. */
export const StateTransitionSchema = z
  .object({
    id: z.string().trim().min(1),
    subjectId: z.string().trim().min(1),
    predicate: z.string().trim().min(1),
    fromValue: CanonValueSchema.nullable().optional(),
    toValue: CanonValueSchema,
    chapterId: z.string().trim().min(1),
    /** Optional aliases used by importers that call the event's chapter an effective chapter. */
    effectiveFromChapterId: z.string().trim().min(1).optional(),
    validFromChapterId: z.string().trim().min(1).optional(),
    sceneId: z.string().trim().min(1).optional(),
    reason: z.string().default(""),
    evidence: z.array(EvidenceRefSchema).min(1),
    certainty: z.number().finite().min(0).max(1).default(1),
    sequence: z.number().int().nonnegative().optional(),
    createdAt: z.string().datetime({ offset: true }).optional()
  })
  .superRefine((value, context) => {
    for (const ref of value.evidence) {
      if (ref.chapterId !== value.chapterId) {
        context.addIssue({
          code: "custom",
          path: ["evidence"],
          message: "State transition evidence must point to the transition chapter"
        });
        break;
      }
    }
  });

export type StateTransition = z.infer<typeof StateTransitionSchema>;

export const StoryThreadTypeSchema = z.enum([
  "foreshadowing",
  "mystery",
  "promise",
  "character_arc",
  "conflict",
  "world_question"
]);

export type StoryThreadType = z.infer<typeof StoryThreadTypeSchema>;

export const StoryThreadStatusSchema = z.enum(["candidate", "active", "progressing", "due", "resolved", "abandoned"]);

export type StoryThreadStatus = z.infer<typeof StoryThreadStatusSchema>;

/** A multi-stage setup -> progress -> payoff thread. */
export const StoryThreadSchema = z
  .object({
    id: z.string().trim().min(1),
    type: StoryThreadTypeSchema.default("foreshadowing"),
    title: z.string().trim().min(1),
    status: StoryThreadStatusSchema.default("candidate"),
    setupRefs: z.array(EvidenceRefSchema).default([]),
    progressRefs: z.array(EvidenceRefSchema).default([]),
    payoffRefs: z.array(EvidenceRefSchema).default([]),
    expectedPayoff: z.string().default(""),
    earliestPayoffChapter: z.number().int().positive().optional(),
    latestPayoffChapter: z.number().int().positive().optional(),
    dependencies: z.array(z.string().trim().min(1)).default([]),
    relatedEntityIds: z.array(z.string().trim().min(1)).default([]),
    confidence: z.number().finite().min(0).max(1).default(0.5),
    locked: z.boolean().default(false),
    legacyClueId: z.string().trim().min(1).optional(),
    notes: z.string().default(""),
    createdAt: z.string().datetime({ offset: true }).optional(),
    updatedAt: z.string().datetime({ offset: true }).optional()
  })
  .superRefine((value, context) => {
    if (
      value.earliestPayoffChapter !== undefined &&
      value.latestPayoffChapter !== undefined &&
      value.latestPayoffChapter < value.earliestPayoffChapter
    ) {
      context.addIssue({
        code: "custom",
        path: ["latestPayoffChapter"],
        message: "latestPayoffChapter must not precede earliestPayoffChapter"
      });
    }
    if (
      value.locked &&
      value.setupRefs.length === 0 &&
      value.progressRefs.length === 0 &&
      value.payoffRefs.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["setupRefs"],
        message: "A locked story thread requires at least one evidence reference"
      });
    }
  });

export type StoryThread = z.infer<typeof StoryThreadSchema>;

const NonNegativeMetric = z.number().finite().nonnegative();
const RatioMetric = z.number().finite().min(0).max(1);

export const CharacterVoiceProfileSchema = z
  .object({
    name: z.string().default(""),
    addressTerms: z.array(z.string()).default([]),
    sentenceLength: z.number().finite().nonnegative().optional(),
    tone: z.string().default(""),
    mannerisms: z.array(z.string()).default([]),
    forbiddenExpressions: z.array(z.string()).default([]),
    exemplars: z.array(EvidenceRefSchema).default([])
  })
  .passthrough();

export type CharacterVoiceProfile = z.infer<typeof CharacterVoiceProfileSchema>;

/** Measurable whole-book style profile plus evidence-backed exemplars. */
export const StyleProfileSchema = z
  .object({
    id: z.string().trim().min(1).default("default"),
    name: z.string().default(""),
    version: z.number().int().positive().default(1),
    narrativeViewpoint: z.string().default(""),
    tense: z.string().default(""),
    focusSwitchRules: z.array(z.string()).default([]),
    sentenceLengthMean: NonNegativeMetric.optional(),
    sentenceLengthDistribution: z.record(z.string(), NonNegativeMetric).default({}),
    paragraphLengthMean: NonNegativeMetric.optional(),
    paragraphLengthDistribution: z.record(z.string(), NonNegativeMetric).default({}),
    /** Raw aggregate metrics are retained so a profile can be re-evaluated without the corpus. */
    metrics: z.record(z.string(), z.unknown()).optional(),
    sourceChapterHashes: z.record(z.string(), z.string()).default({}),
    dialogueRatio: RatioMetric.optional(),
    actionRatio: RatioMetric.optional(),
    psychologyRatio: RatioMetric.optional(),
    environmentRatio: RatioMetric.optional(),
    punctuation: z.record(z.string(), NonNegativeMetric).default({}),
    connectives: z.array(z.string()).default([]),
    idioms: z.array(z.string()).default([]),
    frequentPhrases: z.array(z.string()).default([]),
    chapterOpenings: z.array(z.string()).default([]),
    chapterEndingTypes: z.array(z.string()).default([]),
    revealPacing: z.string().default(""),
    characterVoices: z.record(z.string(), CharacterVoiceProfileSchema).default({}),
    sceneExemplars: z.record(z.string(), z.array(EvidenceRefSchema)).default({}),
    forbiddenPatterns: z.array(z.string()).default([]),
    locked: z.boolean().default(false),
    evidence: z.array(EvidenceRefSchema).default([]),
    notes: z.string().default(""),
    createdAt: z.string().datetime({ offset: true }).optional(),
    updatedAt: z.string().datetime({ offset: true }).optional()
  })
  .passthrough();

export type StyleProfile = z.infer<typeof StyleProfileSchema>;

const ContractStateSchema = z.union([z.string(), z.record(z.string(), z.unknown())]);

/** Hard requirements and exclusions for one continuation chapter. */
export const ChapterContractSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    chapterId: z.string().trim().min(1).optional(),
    title: z.string().default(""),
    targetWords: z.number().int().positive().optional(),
    pov: z.string().default(""),
    mustHappen: z.array(z.string()).default([]),
    mustNotHappen: z.array(z.string()).default([]),
    requiredBeats: z.array(z.string()).default([]),
    forbiddenBeats: z.array(z.string()).default([]),
    entryState: z.array(ContractStateSchema).default([]),
    exitState: z.array(ContractStateSchema).default([]),
    requiredFactIds: z.array(z.string().trim().min(1)).default([]),
    requiredEntityIds: z.array(z.string().trim().min(1)).default([]),
    requiredThreadIds: z.array(z.string().trim().min(1)).default([]),
    threadsToAdvance: z.array(z.string().trim().min(1)).default([]),
    threadsToPayoff: z.array(z.string().trim().min(1)).default([]),
    dueThreadIds: z.array(z.string().trim().min(1)).default([]),
    scenes: z.array(z.record(z.string(), z.unknown())).default([]),
    notes: z.string().default("")
  })
  .superRefine((value, context) => {
    if (!value.id && !value.chapterId) {
      context.addIssue({ code: "custom", path: ["chapterId"], message: "A chapter contract requires id or chapterId" });
    }
  })
  .passthrough();

export type ChapterContract = z.infer<typeof ChapterContractSchema>;

/** All source material selected for a continuation generation run. */
export const EvidencePackSchema = z
  .object({
    hardConstraints: z.array(CanonFactSchema).default([]),
    immediateContinuity: z.array(EvidenceRefSchema).default([]),
    chapterContract: ChapterContractSchema,
    activeCharacterStates: z.array(CanonFactSchema).default([]),
    dueThreads: z.array(StoryThreadSchema).default([]),
    retrievedEvidence: z.array(EvidenceRefSchema).default([]),
    styleExemplars: z.array(EvidenceRefSchema).default([]),
    projectData: z.array(ProjectDataEntrySchema).default([]),
    exclusions: z.array(z.string()).default([]),
    tokenUsageBySection: z.record(z.string(), z.number().finite().nonnegative()).default({}),
    omittedSections: z.array(z.string()).default([]),
    sourceWarnings: z.array(z.string()).default([]),
    generatedAt: z.string().datetime({ offset: true }).optional(),
    query: z.string().default("")
  })
  .passthrough();

export type EvidencePack = z.infer<typeof EvidencePackSchema>;

export interface LegacyClueLike {
  id: string;
  title: string;
  plantedChapterId?: string;
  relatedCharacters?: string[];
  expectedPayoff?: string;
  status?: "planned" | "planted" | "developed" | "resolved" | "abandoned";
  notes?: string;
}

const legacyStatusMap: Record<NonNullable<LegacyClueLike["status"]>, StoryThread["status"]> = {
  planned: "candidate",
  planted: "active",
  developed: "progressing",
  resolved: "resolved",
  abandoned: "abandoned"
};

/**
 * Convert a legacy Clue into a multi-stage thread without losing its id. The
 * generated reference is deliberately marked as a migration pointer; users
 * can replace it with a precise excerpt later.
 */
export const migrateClueToStoryThread = (clue: LegacyClueLike | Clue): StoryThread => {
  const parsed = clue as LegacyClueLike;
  const setupRefs: EvidenceRef[] = parsed.plantedChapterId
    ? [
        {
          chapterId: parsed.plantedChapterId,
          startOffset: 0,
          endOffset: Math.max(1, parsed.title.length),
          excerpt: parsed.title,
          contentHash: `legacy-clue:${parsed.id}`
        }
      ]
    : [];
  return StoryThreadSchema.parse({
    id: parsed.id,
    legacyClueId: parsed.id,
    type: "foreshadowing",
    title: parsed.title,
    status: legacyStatusMap[parsed.status ?? "planned"],
    setupRefs,
    progressRefs: [],
    payoffRefs: [],
    expectedPayoff: parsed.expectedPayoff ?? "",
    dependencies: [],
    relatedEntityIds: parsed.relatedCharacters ?? [],
    confidence: parsed.plantedChapterId ? 0.7 : 0.4,
    locked: false,
    notes: parsed.notes ?? "Migrated from legacy clue"
  });
};

export const migrateCluesToStoryThreads = (clues: Array<LegacyClueLike | Clue>): StoryThread[] =>
  clues.map(migrateClueToStoryThread);

// Friendly aliases used by importers and callers that prefer a noun-first name.
export const storyThreadFromClue = migrateClueToStoryThread;
export const storyThreadsFromClues = migrateCluesToStoryThreads;
