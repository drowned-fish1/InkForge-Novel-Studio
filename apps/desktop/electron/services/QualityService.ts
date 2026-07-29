import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import {
  QualityBaselineSchema,
  QualityReportSchema,
  type QualityDimensionScores,
  type QualityFinding,
  type QualityReport
} from "@inkforge/schemas";
import type { QualitySweepResult } from "../types.js";
import { FileRepository } from "./FileRepository.js";
import { ProjectService } from "./ProjectService.js";
import { StoryStateService } from "./StoryStateService.js";

const reportLimit = 30;

export class QualityService {
  constructor(
    private readonly files = new FileRepository(),
    private readonly projects = new ProjectService(files),
    private readonly story = new StoryStateService(files, projects)
  ) {}

  async evaluateChapter(projectPath: string, chapterId: string): Promise<QualityReport> {
    const project = await this.projects.openProject(projectPath);
    const chapter = project.outline.volumes.flatMap((volume) => volume.chapters).find((item) => item.id === chapterId);
    if (!chapter) {
      throw new Error("Chapter not found.");
    }
    const [content, issues, clues] = await Promise.all([
      this.files.readText(this.files.assertInsideProject(projectPath, chapter.file)),
      this.story.inspect(projectPath),
      this.story.listClues(projectPath)
    ]);
    const report = await this.evaluateText(chapterId, chapter.title, content, {
      continuityIssueCount: issues.filter((issue) => issue.severity !== "info").length,
      openClueCount: clues.filter((clue) => clue.status !== "resolved" && clue.status !== "abandoned").length
    });
    const baseline = await this.getBaseline(projectPath, chapterId);
    const withDelta = QualityReportSchema.parse({
      ...report,
      baselineDelta: baseline ? round(report.overallScore - baseline.overallScore) : undefined
    });
    const reports = await this.listReports(projectPath, chapterId);
    await this.files.writeJsonAtomic(
      this.reportPath(projectPath, chapterId),
      [withDelta, ...reports].slice(0, reportLimit)
    );
    return withDelta;
  }

  async evaluateAll(projectPath: string): Promise<QualitySweepResult> {
    const project = await this.projects.openProject(projectPath);
    const [issues, clues] = await Promise.all([this.story.inspect(projectPath), this.story.listClues(projectPath)]);
    const context = {
      continuityIssueCount: issues.filter((issue) => issue.severity !== "info").length,
      openClueCount: clues.filter((clue) => clue.status !== "resolved" && clue.status !== "abandoned").length
    };
    const chapters = project.outline.volumes
      .flatMap((volume) => volume.chapters)
      .filter((chapter) => !chapter.archived);
    const entries = [];
    for (const chapter of chapters) {
      let content = "";
      try {
        content = await this.files.readText(this.files.assertInsideProject(projectPath, chapter.file));
      } catch {
        // Chapter file missing on disk: evaluate as empty so the sweep surfaces it instead of aborting.
      }
      const report = await this.evaluateText(chapter.id, chapter.title, content, context);
      const baseline = await this.getBaseline(projectPath, chapter.id);
      const withDelta = QualityReportSchema.parse({
        ...report,
        baselineDelta: baseline ? round(report.overallScore - baseline.overallScore) : undefined
      });
      const history = await this.listReports(projectPath, chapter.id);
      // The content fingerprint alone is insufficient: project-level
      // continuity/clue context and the selected baseline can change while
      // chapter prose stays untouched.
      const unchanged = history[0] ? qualityStateKey(history[0]) === qualityStateKey(withDelta) : false;
      if (!unchanged) {
        await this.files.writeJsonAtomic(
          this.reportPath(projectPath, chapter.id),
          [withDelta, ...history].slice(0, reportLimit)
        );
      }
      entries.push({
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        wordCount: withDelta.wordCount,
        overallScore: withDelta.overallScore,
        baselineDelta: withDelta.baselineDelta,
        warningCount: withDelta.findings.filter((item) => item.severity === "warning").length,
        infoCount: withDelta.findings.filter((item) => item.severity === "info").length,
        topFinding: withDelta.findings[0]?.title
      });
    }
    entries.sort((a, b) => a.overallScore - b.overallScore);
    return {
      generatedAt: new Date().toISOString(),
      chapterCount: entries.length,
      averageScore: entries.length
        ? round(entries.reduce((total, entry) => total + entry.overallScore, 0) / entries.length)
        : 0,
      continuityIssueCount: context.continuityIssueCount,
      entries
    };
  }

  async evaluateText(
    chapterId: string,
    chapterTitle: string,
    content: string,
    context: { continuityIssueCount?: number; openClueCount?: number } = {}
  ): Promise<QualityReport> {
    const body = content.replace(/^#.*$/mu, "").trim();
    const paragraphs = body
      .split(/\n\s*\n/u)
      .map((item) => item.trim())
      .filter(Boolean);
    const sentences = body
      .split(/[。！？!?]\s*/u)
      .map((item) => item.trim())
      .filter((item) => item.length >= 4);
    const findings: QualityFinding[] = [];
    const words = countWords(body);
    const repeated = repeatedSentences(sentences);
    const longSentences = sentences.filter((sentence) => sentence.length > 90);
    const longParagraphs = paragraphs.filter((paragraph) => paragraph.length > 420);
    const dialogueChars = [...body.matchAll(/[“「『"]([^”」』"]+)[”」』"]/gu)].reduce(
      (total, match) => total + (match[1]?.length ?? 0),
      0
    );
    const dialogueRatio = body.length ? dialogueChars / body.length : 0;
    const continuityPenalty = Math.min(35, (context.continuityIssueCount ?? 0) * 8);

    if (words < 500) {
      findings.push(
        finding(
          "pacing",
          "warning",
          "章节体量偏短",
          `当前约 ${words} 字，可能不足以完成完整的场景转折。`,
          "",
          "补足目标、阻力与结果三个节拍。"
        )
      );
    }
    if (longParagraphs.length) {
      findings.push(
        finding(
          "pacing",
          "warning",
          "长段落影响节奏",
          `${longParagraphs.length} 个段落超过 420 字。`,
          clip(longParagraphs[0]),
          "在动作、视角或情绪转折处拆段。"
        )
      );
    }
    if (longSentences.length) {
      findings.push(
        finding(
          "style",
          "info",
          "部分句子过长",
          `${longSentences.length} 个句子超过 90 字。`,
          clip(longSentences[0]),
          "拆分修饰层级，让主干动作更清楚。"
        )
      );
    }
    if (repeated.length) {
      findings.push(
        finding(
          "repetition",
          "warning",
          "发现重复表达",
          `${repeated.length} 组句子重复出现。`,
          clip(repeated[0]),
          "保留信息量最大的一处，其余改为推进性动作。"
        )
      );
    }
    if (body.length > 1200 && dialogueRatio < 0.03) {
      findings.push(
        finding(
          "character",
          "info",
          "角色声音偏少",
          "较长章节中的直接对话占比较低。",
          "",
          "在关键冲突点加入角色具有辨识度的回应。"
        )
      );
    }
    if ((context.continuityIssueCount ?? 0) > 0) {
      findings.push(
        finding(
          "continuity",
          "warning",
          "项目存在连续性风险",
          `检测到 ${context.continuityIssueCount} 个未解决的一致性问题。`,
          "",
          "先在时间线、伏笔和术语库中处理高优先级问题。"
        )
      );
    }
    if ((context.openClueCount ?? 0) > 5 && !/[线索伏笔秘密真相]/u.test(body)) {
      findings.push(
        finding(
          "clue",
          "info",
          "伏笔承接偏弱",
          `项目有 ${context.openClueCount} 条未回收伏笔，本章未见明显承接信号。`,
          "",
          "确认本章是否需要推进至少一条主线伏笔。"
        )
      );
    }

    const dimensionScores: QualityDimensionScores = {
      continuity: clamp(94 - continuityPenalty),
      character: clamp(88 - (body.length > 1200 && dialogueRatio < 0.03 ? 10 : 0)),
      pacing: clamp(92 - Math.min(24, longParagraphs.length * 5) - (words < 500 ? 14 : 0)),
      style: clamp(93 - Math.min(24, longSentences.length * 3)),
      repetition: clamp(96 - Math.min(35, repeated.length * 9)),
      clue: clamp(90 - ((context.openClueCount ?? 0) > 5 && !/[线索伏笔秘密真相]/u.test(body) ? 10 : 0))
    };
    const overallScore = round(
      dimensionScores.continuity * 0.22 +
        dimensionScores.character * 0.18 +
        dimensionScores.pacing * 0.18 +
        dimensionScores.style * 0.16 +
        dimensionScores.repetition * 0.14 +
        dimensionScores.clue * 0.12
    );

    return QualityReportSchema.parse({
      id: randomUUID(),
      chapterId,
      chapterTitle,
      createdAt: new Date().toISOString(),
      fingerprint: fingerprint(content),
      wordCount: words,
      overallScore,
      dimensionScores,
      findings
    });
  }

  async listReports(projectPath: string, chapterId: string): Promise<QualityReport[]> {
    try {
      const raw = await this.files.readJson<unknown[]>(this.reportPath(projectPath, chapterId));
      return raw.map((item) => QualityReportSchema.parse(item));
    } catch {
      return [];
    }
  }

  async setBaseline(projectPath: string, reportId: string, chapterId: string): Promise<QualityReport> {
    const report = (await this.listReports(projectPath, chapterId)).find((item) => item.id === reportId);
    if (!report) {
      throw new Error("Quality report not found.");
    }
    const baseline = QualityBaselineSchema.parse({
      reportId,
      chapterId,
      createdAt: new Date().toISOString(),
      overallScore: report.overallScore,
      dimensionScores: report.dimensionScores
    });
    await this.files.writeJsonAtomic(this.baselinePath(projectPath, chapterId), baseline);
    return report;
  }

  private async getBaseline(projectPath: string, chapterId: string) {
    try {
      return QualityBaselineSchema.parse(await this.files.readJson(this.baselinePath(projectPath, chapterId)));
    } catch {
      return undefined;
    }
  }

  private reportPath(projectPath: string, chapterId: string): string {
    return this.files.assertInsideProject(
      projectPath,
      path.posix.join(".inkforge", "quality", `${safeId(chapterId)}.json`)
    );
  }

  private baselinePath(projectPath: string, chapterId: string): string {
    return this.files.assertInsideProject(
      projectPath,
      path.posix.join(".inkforge", "quality", "baselines", `${safeId(chapterId)}.json`)
    );
  }
}

const finding = (
  dimension: QualityFinding["dimension"],
  severity: QualityFinding["severity"],
  title: string,
  detail: string,
  evidence: string,
  suggestion: string
): QualityFinding => ({ id: randomUUID(), dimension, severity, title, detail, evidence, suggestion });

export const fingerprint = (value: string): string => createHash("sha256").update(value).digest("hex").slice(0, 16);
const safeId = (value: string): string => value.replace(/[^\w.-]/gu, "_");
const clip = (value = ""): string => (value.length > 120 ? `${value.slice(0, 117)}…` : value);
const clamp = (value: number): number => Math.max(0, Math.min(100, round(value)));
const round = (value: number): number => Math.round(value * 10) / 10;
const countWords = (value: string): number => {
  const latin = value.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/gu)?.length ?? 0;
  const cjk = value.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0;
  return latin + cjk;
};
const repeatedSentences = (sentences: string[]): string[] => {
  const seen = new Map<string, number>();
  for (const sentence of sentences) {
    const key = sentence.replace(/[\s，、；：,.]/gu, "").toLowerCase();
    if (key.length >= 8) {
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
  }
  return [...seen.entries()].filter(([, count]) => count > 1).map(([sentence]) => sentence);
};

const qualityStateKey = (report: QualityReport): string =>
  JSON.stringify({
    fingerprint: report.fingerprint,
    baselineDelta: report.baselineDelta,
    overallScore: report.overallScore,
    dimensionScores: report.dimensionScores,
    findings: report.findings.map(({ dimension, severity, title, detail, evidence, suggestion }) => ({
      dimension,
      severity,
      title,
      detail,
      evidence,
      suggestion
    }))
  });
