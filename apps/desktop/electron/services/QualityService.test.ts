import { describe, expect, it } from "vitest";
import { QualityService } from "./QualityService.js";

describe("QualityService", () => {
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
