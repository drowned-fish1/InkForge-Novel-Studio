import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ChapterService } from "./ChapterService.js";
import { FileRepository } from "./FileRepository.js";
import { ProjectService } from "./ProjectService.js";
import { QualityService } from "./QualityService.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("QualityService", () => {
  it("evaluates every chapter in one sweep sorted worst-first", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "inkforge-sweep-"));
    temporaryRoots.push(root);
    const files = new FileRepository();
    const projects = new ProjectService(files);
    const chapters = new ChapterService(files);
    const service = new QualityService(files, projects);
    const project = await projects.createProject(root, {
      title: "巡检测试",
      author: "tester",
      genre: [],
      targetWords: 100000,
      style: "",
      protagonist: "",
      premise: ""
    });
    const first = project.outline.volumes[0].chapters[0];
    await chapters.saveChapter({
      projectPath: project.projectPath,
      file: first.file,
      content: "短章。"
    });
    const second = await projects.createChapter({
      projectPath: project.projectPath,
      volumeId: project.outline.volumes[0].id
    });
    const secondPlan = second.outline.volumes[0].chapters[1];
    await chapters.saveChapter({
      projectPath: project.projectPath,
      file: secondPlan.file,
      content: `他沿着堤岸走了很久，风把外套吹得猎猎作响。${"她说：“我们还有机会。”他点头，把地图折好塞进口袋。".repeat(30)}`
    });

    const sweep = await service.evaluateAll(project.projectPath);
    expect(sweep.chapterCount).toBe(2);
    expect(sweep.entries).toHaveLength(2);
    expect(sweep.entries[0].overallScore).toBeLessThanOrEqual(sweep.entries[1].overallScore);
    const shortEntry = sweep.entries.find((entry) => entry.chapterId === first.id);
    expect(shortEntry?.warningCount).toBeGreaterThan(0);
    expect(shortEntry?.topFinding).toBeTruthy();
    expect(sweep.averageScore).toBeGreaterThan(0);
    const history = await service.listReports(project.projectPath, first.id);
    expect(history).toHaveLength(1);

    const again = await service.evaluateAll(project.projectPath);
    expect(again.chapterCount).toBe(2);
    expect(await service.listReports(project.projectPath, first.id)).toHaveLength(1);

    const refreshed = await projects.openProject(project.projectPath);
    refreshed.outline.volumes[0].chapters[0].characters = ["不存在的人物"];
    await projects.updateOutline({ projectPath: project.projectPath, outline: refreshed.outline });
    await service.evaluateAll(project.projectPath);
    expect(await service.listReports(project.projectPath, first.id)).toHaveLength(2);

    await service.evaluateAll(project.projectPath);
    expect(await service.listReports(project.projectPath, first.id)).toHaveLength(2);
  });

  it("produces deterministic dimensions and flags repeated prose", async () => {
    const service = new QualityService();
    const repeated = "门外传来三声敲门，屋里的人没有回答";
    const report = await service.evaluateText(
      "ch-1",
      "第一章",
      `# 第一章\n\n${repeated}。${repeated}。\n\n${"很长的一段叙述。".repeat(80)}`,
      { continuityIssueCount: 2, openClueCount: 8 }
    );

    expect(report.overallScore).toBeGreaterThanOrEqual(0);
    expect(report.overallScore).toBeLessThanOrEqual(100);
    expect(report.dimensionScores.continuity).toBeLessThan(94);
    expect(report.findings.some((finding) => finding.dimension === "repetition")).toBe(true);
    expect(report.findings.some((finding) => finding.dimension === "continuity")).toBe(true);
  });
});
