import path from "node:path";
import { RevisionStateSchema, type RevisionState, type WritingAnnotation } from "@inkforge/schemas";
import type { RevisionOverview, RevisionProposalSummary } from "../types.js";
import { ChatAgentService } from "./ChatAgentService.js";
import { FileRepository } from "./FileRepository.js";
import { ProjectService } from "./ProjectService.js";
import { QualityService } from "./QualityService.js";
import { StoryStateService } from "./StoryStateService.js";
import { WorkspaceService } from "./WorkspaceService.js";

/**
 * Aggregates every revision-relevant signal (manual annotations, quality
 * findings, continuity issues, pending agent proposals) into one overview and
 * tracks accept/ignore/defer dispositions for items that carry no own status.
 * Works fully without an AI provider: all sources are local.
 */
export class RevisionService {
  constructor(
    private readonly files: FileRepository,
    private readonly projects: ProjectService,
    private readonly workspace: WorkspaceService,
    private readonly quality: QualityService,
    private readonly story: StoryStateService,
    private readonly chatAgent: ChatAgentService
  ) {}

  async overview(projectPath: string): Promise<RevisionOverview> {
    const project = await this.projects.openProject(projectPath);
    const chapters = project.outline.volumes.flatMap((volume) => volume.chapters);
    const chapterTitle = new Map(chapters.map((chapter) => [chapter.id, chapter.title]));

    const [writingWorkspace, continuityIssues, revisionState] = await Promise.all([
      this.workspace.loadWritingWorkspace(projectPath),
      this.story.inspect(projectPath).catch(() => []),
      this.loadState(projectPath)
    ]);

    const annotations = writingWorkspace.annotations.map((annotation: WritingAnnotation) => ({
      ...annotation,
      chapterTitle: chapterTitle.get(annotation.chapterId) ?? annotation.chapterId
    }));

    const qualityReports: RevisionOverview["qualityReports"] = [];
    for (const chapter of chapters) {
      const reports = await this.quality.listReports(projectPath, chapter.id);
      const latest = reports[0];
      if (latest) {
        qualityReports.push({
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          overallScore: latest.overallScore,
          baselineDelta: latest.baselineDelta,
          createdAt: latest.createdAt,
          findings: latest.findings
        });
      }
    }

    const proposals: RevisionProposalSummary[] = [];
    // One directory scan instead of a per-chapter load (which re-parses the
    // whole project each call) — keeps the workbench fast on large novels.
    const sessions = await this.chatAgent.listExistingSessions(projectPath);
    for (const session of sessions) {
      const title = chapterTitle.get(session.chapterId) ?? session.chapterId;
      for (const proposal of session.proposals) {
        if (proposal.status !== "pending") {
          continue;
        }
        proposals.push({
          id: proposal.id,
          chapterId: session.chapterId,
          chapterTitle: title,
          kind: "change",
          mode: proposal.mode,
          title: proposal.mode === "append" ? "续写提案" : proposal.mode === "replace" ? "替换提案" : "结构化改稿",
          explanation: proposal.explanation,
          createdAt: proposal.createdAt,
          blockCount: proposal.blocks.length,
          contentPreview: proposal.content.slice(0, 200)
        });
      }
      for (const proposal of session.dataProposals) {
        if (proposal.status !== "pending") {
          continue;
        }
        proposals.push({
          id: proposal.id,
          chapterId: session.chapterId,
          chapterTitle: title,
          kind: "data",
          entityType: proposal.entityType,
          title: proposal.title,
          explanation: proposal.explanation,
          createdAt: proposal.createdAt,
          blockCount: 0,
          contentPreview: JSON.stringify(proposal.payload).slice(0, 200)
        });
      }
    }

    return { annotations, qualityReports, continuityIssues, proposals, revisionState };
  }

  async setDisposition(
    projectPath: string,
    key: string,
    status: "open" | "accepted" | "ignored" | "deferred",
    note = ""
  ): Promise<RevisionState> {
    if (!key.trim()) {
      throw new Error("Disposition key is required.");
    }
    const state = await this.loadState(projectPath);
    const now = new Date().toISOString();
    const existing = state.dispositions.findIndex((item) => item.key === key);
    const disposition = { key, status, note, updatedAt: now };
    const dispositions =
      existing >= 0
        ? state.dispositions.map((item, index) => (index === existing ? disposition : item))
        : [...state.dispositions, disposition];
    const next = RevisionStateSchema.parse({ dispositions });
    await this.files.writeJsonAtomic(this.statePath(projectPath), next);
    return next;
  }

  private async loadState(projectPath: string): Promise<RevisionState> {
    try {
      return RevisionStateSchema.parse(await this.files.readJson(this.statePath(projectPath)));
    } catch {
      return RevisionStateSchema.parse({});
    }
  }

  private statePath(projectPath: string): string {
    return this.files.assertInsideProject(projectPath, path.posix.join(".inkforge", "revision-state.json"));
  }
}
