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
});
