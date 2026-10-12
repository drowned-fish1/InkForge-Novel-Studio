import type { ReleaseReadiness, ReleaseReadinessItem } from "../types.js";
import { AiProviderService } from "./AiProviderService.js";
import { BatchProductionService } from "./BatchProductionService.js";
import { BranchService } from "./BranchService.js";
import { ProjectService } from "./ProjectService.js";
import { QualityService } from "./QualityService.js";

export class ReleaseService {
  constructor(
    private readonly projects: ProjectService,
    private readonly provider: AiProviderService,
    private readonly quality: QualityService,
    private readonly branches: BranchService,
    private readonly batches: BatchProductionService
  ) {}

  async inspect(projectPath: string): Promise<ReleaseReadiness> {
    const [project, projectIssues, provider, branches, batchRuns] = await Promise.all([
      this.projects.openProject(projectPath),
      this.projects.inspectProject(projectPath),
      this.provider.getStatus(),
      this.branches.list(projectPath),
      this.batches.list(projectPath)
    ]);
    const chapters = project.outline.volumes
      .flatMap((volume) => volume.chapters)
      .filter((chapter) => !chapter.archived);
    const reports = (
      await Promise.all(chapters.map((chapter) => this.quality.listReports(projectPath, chapter.id)))
    ).flat();
    const latestReportCount = new Set(reports.map((report) => report.chapterId)).size;
    const configuredProviders = [provider, ...Object.values(provider.taskProviders ?? {})].filter(
      (endpoint) => endpoint.configured
    );
    const items: ReleaseReadinessItem[] = [
      {
        id: "project-shape",
        label: "项目结构",
        status: projectIssues.length ? "blocked" : "ready",
        detail: projectIssues.length ? projectIssues.join("；") : "核心项目文件齐全。"
      },
      {
        id: "provider",
        label: "模型配置",
        status: configuredProviders.length ? "ready" : "warning",
        detail: configuredProviders.length
          ? configuredProviders.map((endpoint) => `${endpoint.displayName} · ${endpoint.model}`).join("；")
          : "尚未配置可用模型；离线编辑不受影响。"
      },
      {
        id: "quality",
        label: "质量回归",
        status: latestReportCount === chapters.length && chapters.length > 0 ? "ready" : "warning",
        detail: chapters.length
          ? `${latestReportCount}/${chapters.length} 个有效章节已有质量报告。`
          : "项目中没有可发布章节。"
      },
      {
        id: "branches",
        label: "待处理分支",
        status: branches.some((branch) => branch.status === "draft") ? "warning" : "ready",
        detail: branches.some((branch) => branch.status === "draft")
          ? `${branches.filter((branch) => branch.status === "draft").length} 个草稿分支尚未决定。`
          : "没有待处理的草稿分支。"
      },
      {
        id: "batch",
        label: "批量任务",
        status: batchRuns.some((run) => run.status === "running") ? "blocked" : "ready",
        detail: batchRuns.some((run) => run.status === "running") ? "仍有批量任务正在运行。" : "没有运行中的批量任务。"
      },
      {
        id: "manuscript",
        label: "正文完整度",
        status:
          chapters.length &&
          chapters.every((chapter) => chapter.status === "done" || chapter.actualWords >= chapter.targetWords * 0.5)
            ? "ready"
            : "warning",
        detail: `${chapters.length} 个有效章节；发布前请确认标题、顺序和字数。`
      },
      {
        id: "distribution",
        label: "签名与自动更新",
        status: "warning",
        detail: "本地安装包可生成；公开分发前需配置代码签名证书和更新源。"
      }
    ];
    const score = Math.round(
      items.reduce((total, item) => total + (item.status === "ready" ? 100 : item.status === "warning" ? 55 : 0), 0) /
        items.length
    );
    return {
      checkedAt: new Date().toISOString(),
      score,
      ready: items.every((item) => item.status !== "blocked"),
      items
    };
  }
}
