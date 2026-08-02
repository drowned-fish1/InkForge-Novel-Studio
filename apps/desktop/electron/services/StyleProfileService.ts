import { createHash } from "node:crypto";
import path from "node:path";
import {
  analyzeProseStyle,
  compareProseStyle,
  mergeProseStyleMetrics,
  type ProseStyleMetrics
} from "@inkforge/agent-engine";
import { StyleProfileSchema, type EvidenceRef, type StyleProfile } from "@inkforge/schemas";
import { FileRepository } from "./FileRepository.js";
import { ProjectService } from "./ProjectService.js";

export interface StyleProfileBuildResult {
  profile: StyleProfile;
  analyzedChapters: number;
  analyzedCharacters: number;
  skippedChapters: string[];
}

export interface StyleEvaluationResult {
  score: number;
  warnings: string[];
  deltas: Array<{
    metric: string;
    baseline: number;
    actual: number;
    relativeDelta: number;
    severity: "info" | "warning";
  }>;
}

export class StyleProfileService {
  constructor(
    private readonly files = new FileRepository(),
    private readonly projects = new ProjectService(files)
  ) {}

  async load(projectPath: string): Promise<StyleProfile | undefined> {
    try {
      return StyleProfileSchema.parse(await this.files.readJson(this.profilePath(projectPath)));
    } catch (error) {
      if (isMissingFile(error)) return undefined;
      throw error;
    }
  }

  async analyzeProject(
    projectPath: string,
    options: { chapterIds?: string[]; maxExemplarsPerType?: number } = {}
  ): Promise<StyleProfileBuildResult> {
    const project = await this.projects.openProject(projectPath);
    const selectedIds = options.chapterIds?.length ? new Set(options.chapterIds) : undefined;
    const chapters = project.outline.volumes
      .flatMap((volume) => volume.chapters)
      .filter((chapter) => !chapter.archived && (!selectedIds || selectedIds.has(chapter.id)));
    const metrics = [];
    const skippedChapters: string[] = [];
    const sourceChapterHashes: Record<string, string> = {};
    const exemplars: Record<string, EvidenceRef[]> = { dialogue: [], narrative: [] };
    const maxExemplars = Math.max(1, Math.min(12, options.maxExemplarsPerType ?? 4));

    for (const chapter of chapters) {
      let content: string;
      try {
        content = await this.files.readText(this.files.assertInsideProject(projectPath, chapter.file));
      } catch {
        skippedChapters.push(chapter.id);
        continue;
      }
      if (!content.trim()) {
        skippedChapters.push(chapter.id);
        continue;
      }
      const measured = analyzeProseStyle(content);
      metrics.push(measured);
      const hash = createHash("sha256").update(content).digest("hex");
      sourceChapterHashes[chapter.id] = hash;
      const excerpt = representativeExcerpt(content);
      const startOffset = Math.max(0, content.indexOf(excerpt));
      const ref: EvidenceRef = {
        chapterId: chapter.id,
        startOffset,
        endOffset: startOffset + excerpt.length,
        excerpt,
        contentHash: hash
      };
      const kind = measured.dialogueRatio >= 0.18 ? "dialogue" : "narrative";
      if (exemplars[kind].length < maxExemplars) exemplars[kind].push(ref);
    }

    const merged = mergeProseStyleMetrics(metrics);
    const now = new Date().toISOString();
    const existing = await this.load(projectPath);
    const profile = StyleProfileSchema.parse({
      ...existing,
      id: existing?.id ?? "default",
      name: existing?.name || `${project.meta.title} · 文风基线`,
      version: (existing?.version ?? 0) + 1,
      sentenceLengthMean: merged.averageSentenceLength,
      sentenceLengthDistribution: { standardDeviation: merged.sentenceLengthDeviation },
      paragraphLengthMean: merged.averageParagraphLength,
      dialogueRatio: merged.dialogueRatio,
      punctuation: merged.punctuation,
      connectives: Object.entries(merged.connectorFrequency)
        .filter(([, frequency]) => frequency > 0)
        .sort((left, right) => right[1] - left[1])
        .map(([connector]) => connector),
      sceneExemplars: exemplars,
      evidence: [...exemplars.dialogue, ...exemplars.narrative],
      sourceChapterHashes,
      metrics: merged,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    });
    await this.files.writeJsonAtomic(this.profilePath(projectPath), profile);
    return {
      profile,
      analyzedChapters: metrics.length,
      analyzedCharacters: merged.characterCount,
      skippedChapters
    };
  }

  async evaluateText(projectPath: string, text: string, tolerance = 0.35): Promise<StyleEvaluationResult> {
    const profile = await this.load(projectPath);
    if (!profile) throw new Error("请先建立项目文风基线。");
    const baseline = profileMetrics(profile);
    return compareProseStyle(baseline, analyzeProseStyle(text), tolerance);
  }

  private profilePath(projectPath: string): string {
    return this.files.assertInsideProject(projectPath, path.posix.join("canon", "style-profile.json"));
  }
}

const profileMetrics = (profile: StyleProfile) => {
  const raw = (profile as StyleProfile & { metrics?: unknown }).metrics;
  if (isProseStyleMetrics(raw)) {
    return raw;
  }
  return {
    ...analyzeProseStyle(""),
    averageSentenceLength: profile.sentenceLengthMean ?? 0,
    sentenceLengthDeviation: profile.sentenceLengthDistribution.standardDeviation ?? 0,
    averageParagraphLength: profile.paragraphLengthMean ?? 0,
    dialogueRatio: profile.dialogueRatio ?? 0,
    punctuation: profile.punctuation
  };
};

const isProseStyleMetrics = (value: unknown): value is ProseStyleMetrics => {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const numeric = [
    "characterCount",
    "sentenceCount",
    "paragraphCount",
    "dialogueCharacters",
    "dialogueRatio",
    "averageSentenceLength",
    "sentenceLengthDeviation",
    "averageParagraphLength"
  ];
  return (
    numeric.every((key) => typeof record[key] === "number") &&
    Boolean(record.punctuation && typeof record.punctuation === "object") &&
    Boolean(record.connectorFrequency && typeof record.connectorFrequency === "object")
  );
};

const representativeExcerpt = (content: string): string => {
  const trimmed = content.trim();
  if (trimmed.length <= 420) return trimmed;
  const start = Math.min(trimmed.length - 420, Math.floor(trimmed.length * 0.25));
  return trimmed.slice(start, start + 420).trim();
};

const isMissingFile = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT";
