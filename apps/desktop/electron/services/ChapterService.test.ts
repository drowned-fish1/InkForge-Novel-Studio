import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ChapterService } from "./ChapterService.js";

const temporaryProjects: string[] = [];

const createProjectFixture = async () => {
  const projectPath = await mkdtemp(path.join(os.tmpdir(), "inkforge-chapters-"));
  temporaryProjects.push(projectPath);
  return projectPath;
};

afterEach(async () => {
  for (const projectPath of temporaryProjects.splice(0)) {
    await rm(projectPath, { recursive: true, force: true });
  }
});

describe("ChapterService history", () => {
  it("writes a history version before overwriting existing content", async () => {
    const projectPath = await createProjectFixture();
    const service = new ChapterService();
    const file = "chapters/volume-001/ch-0001.md";

    await service.saveChapter({ projectPath, file, content: "第一版" });
    expect(await service.listHistoryVersions(projectPath, file)).toHaveLength(0);

    await service.saveChapter({ projectPath, file, content: "第二版" });
    const versions = await service.listHistoryVersions(projectPath, file);
    expect(versions).toHaveLength(1);
    expect(await service.readHistoryVersion(projectPath, file, versions[0].id)).toBe("第一版");
    expect(await readFile(path.join(projectPath, file), "utf8")).toBe("第二版");
  });

  it("skips history when content is unchanged", async () => {
    const projectPath = await createProjectFixture();
    const service = new ChapterService();
    const file = "chapters/volume-001/ch-0001.md";

    await service.saveChapter({ projectPath, file, content: "同一版" });
    await service.saveChapter({ projectPath, file, content: "同一版" });
    expect(await service.listHistoryVersions(projectPath, file)).toHaveLength(0);
  });

  it("restores a history version and preserves the replaced content as history", async () => {
    const projectPath = await createProjectFixture();
    const service = new ChapterService();
    const file = "chapters/volume-001/ch-0001.md";

    await service.saveChapter({ projectPath, file, content: "旧版" });
    await service.saveChapter({ projectPath, file, content: "新版" });
    const [entry] = await service.listHistoryVersions(projectPath, file);
    const restored = await service.restoreHistoryVersion(projectPath, file, entry.id);

    expect(restored).toBe("旧版");
    expect(await readFile(path.join(projectPath, file), "utf8")).toBe("旧版");
    const versions = await service.listHistoryVersions(projectPath, file);
    expect(versions.length).toBeGreaterThanOrEqual(2);
  });

  it("aggregates history across chapters in one overview call", async () => {
    const projectPath = await createProjectFixture();
    const service = new ChapterService();
    const first = "chapters/volume-001/ch-0001.md";
    const second = "chapters/volume-001/ch-0002.md";

    await service.saveChapter({ projectPath, file: first, content: "一" });
    await service.saveChapter({ projectPath, file: first, content: "二" });
    await service.saveChapter({ projectPath, file: second, content: "只有一版" });

    const overview = await service.listHistoryOverview(projectPath, [first, second]);
    expect(overview[first]).toHaveLength(1);
    expect(overview[second]).toHaveLength(0);
  });

  it("rejects malformed history ids", async () => {
    const projectPath = await createProjectFixture();
    const service = new ChapterService();
    await expect(service.readHistoryVersion(projectPath, "chapters/ch-0001.md", "../escape.md")).rejects.toThrow(
      "Invalid chapter history id"
    );
  });
});
