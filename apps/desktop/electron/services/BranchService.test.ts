import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BranchService, diffLines } from "./BranchService.js";

describe("story branch diff", () => {
  it("keeps context order and marks additions and removals", () => {
    const diff = diffLines("第一行\n旧转折\n结尾", "第一行\n新转折\n结尾");

    expect(diff).toEqual([
      { kind: "context", text: "第一行" },
      { kind: "add", text: "新转折" },
      { kind: "remove", text: "旧转折" },
      { kind: "context", text: "结尾" }
    ]);
  });

  it("does not treat a corrupt branch file as an empty collection", async () => {
    const projectPath = await mkdtemp(path.join(os.tmpdir(), "inkforge-branches-corrupt-"));
    try {
      await mkdir(path.join(projectPath, ".inkforge"), { recursive: true });
      await writeFile(path.join(projectPath, ".inkforge", "story-branches.json"), "{broken", "utf8");

      await expect(new BranchService().list(projectPath)).rejects.toThrow();
    } finally {
      await rm(projectPath, { recursive: true, force: true });
    }
  });

  it("refuses to apply a continuation branch with unresolved hard failures", async () => {
    const projectPath = await mkdtemp(path.join(os.tmpdir(), "inkforge-branch-blocked-"));
    try {
      await mkdir(path.join(projectPath, ".inkforge", "continuation"), { recursive: true });
      const now = new Date().toISOString();
      await writeFile(
        path.join(projectPath, ".inkforge", "story-branches.json"),
        JSON.stringify([
          {
            schemaVersion: "0.1.0",
            id: "branch-blocked",
            chapterId: "ch-1",
            name: "blocked",
            description: "",
            baseFingerprint: "hash",
            baseContent: "",
            content: "draft",
            status: "draft",
            source: "agent",
            createdAt: now,
            updatedAt: now
          }
        ]),
        "utf8"
      );
      await writeFile(
        path.join(projectPath, ".inkforge", "continuation", "runs.json"),
        JSON.stringify([{ branchId: "branch-blocked", status: "blocked", validation: { hardFailures: 1 } }]),
        "utf8"
      );
      await expect(new BranchService().apply(projectPath, "branch-blocked")).rejects.toThrow("硬冲突");
    } finally {
      await rm(projectPath, { recursive: true, force: true });
    }
  });
});
