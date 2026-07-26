import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceService } from "./WorkspaceService.js";

const temporaryProjects: string[] = [];

const createProjectFixture = async () => {
  const projectPath = await mkdtemp(path.join(os.tmpdir(), "inkforge-workspace-"));
  temporaryProjects.push(projectPath);
  await writeFile(path.join(projectPath, "project.novel.json"), '{"title":"测试项目"}', "utf8");
  await writeFile(path.join(projectPath, "outline.json"), '{"volumes":[]}', "utf8");
  return projectPath;
};

afterEach(async () => {
  for (const projectPath of temporaryProjects.splice(0)) {
    await rm(projectPath, { recursive: true, force: true });
  }
});

describe("WorkspaceService backups", () => {
  it("rejects dot-segment backup ids", async () => {
    const projectPath = await createProjectFixture();
    try {
      const service = new WorkspaceService();
      await expect(service.deleteBackup(projectPath, ".")).rejects.toThrow("Invalid backup id");
      await expect(service.deleteBackup(projectPath, "..")).rejects.toThrow("Invalid backup id");
    } finally {
      await rm(projectPath, { recursive: true, force: true });
    }
  });

  it("creates a restorable project snapshot and a protection point before restore", async () => {
    const projectPath = await createProjectFixture();
    const service = new WorkspaceService();
    const memoryDirectory = path.join(projectPath, ".inkforge", "agents", "memory");
    await mkdir(memoryDirectory, { recursive: true });
    await writeFile(path.join(memoryDirectory, "chapter-1.json"), '{"summary":"snapshot"}', "utf8");
    const snapshot = await service.createBackup(projectPath, "manual", "初始版本");

    await writeFile(path.join(projectPath, "outline.json"), '{"volumes":[{"id":"changed"}]}', "utf8");
    await writeFile(path.join(memoryDirectory, "chapter-1.json"), '{"summary":"future"}', "utf8");
    await writeFile(path.join(memoryDirectory, "chapter-2.json"), '{"summary":"new"}', "utf8");
    await mkdir(path.join(projectPath, "chapters"), { recursive: true });
    await writeFile(path.join(projectPath, "chapters", "created-after-snapshot.md"), "future chapter", "utf8");
    await service.restoreBackup(projectPath, snapshot.id);

    expect(await readFile(path.join(projectPath, "outline.json"), "utf8")).toBe('{"volumes":[]}');
    expect(await readFile(path.join(memoryDirectory, "chapter-1.json"), "utf8")).toBe('{"summary":"snapshot"}');
    await expect(readFile(path.join(memoryDirectory, "chapter-2.json"), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(
      readFile(path.join(projectPath, "chapters", "created-after-snapshot.md"), "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" });
    const backups = await service.listBackups(projectPath);
    expect(backups.some((item) => item.reason === "before-restore")).toBe(true);
    expect(backups.find((item) => item.id === snapshot.id)?.label).toBe("初始版本");
  });

  it("deduplicates automatic snapshots inside the interval", async () => {
    const projectPath = await createProjectFixture();
    const service = new WorkspaceService();

    const first = await service.ensureAutomaticBackup(projectPath);
    const second = await service.ensureAutomaticBackup(projectPath);

    expect(first?.reason).toBe("automatic");
    expect(second).toBeUndefined();
    expect(await service.listBackups(projectPath)).toHaveLength(1);
  });

  it("coalesces concurrent automatic snapshot requests", async () => {
    const projectPath = await createProjectFixture();
    const service = new WorkspaceService();

    await Promise.all(Array.from({ length: 8 }, () => service.ensureAutomaticBackup(projectPath)));

    expect(await service.listBackups(projectPath)).toHaveLength(1);
  });
});

describe("WorkspaceService project preferences", () => {
  it("persists writing notes and Agent extension profiles", async () => {
    const projectPath = await createProjectFixture();
    const service = new WorkspaceService();

    await service.saveWritingWorkspace(projectPath, {
      annotations: [
        {
          id: "note-1",
          chapterId: "ch-1",
          start: 0,
          end: 2,
          quote: "开头",
          note: "再加强",
          color: "green",
          createdAt: "2026-07-24T00:00:00.000Z"
        }
      ],
      bookmarks: [],
      sessions: []
    });
    await service.saveAgentExtensions(projectPath, {
      promptPresets: [{ id: "prompt-1", name: "检查节奏", prompt: "检查本章节奏", builtIn: false }],
      toolProfiles: [
        {
          id: "profile-1",
          name: "只读检查",
          allowedTools: ["get_chapter_context", "inspect_continuity"],
          maxTurns: 4,
          maxToolCalls: 6,
          maxTotalTokens: 12000
        }
      ],
      customTools: []
    });

    expect((await service.loadWritingWorkspace(projectPath)).annotations[0].note).toBe("再加强");
    expect((await service.loadAgentExtensions(projectPath)).toolProfiles[0].name).toBe("只读检查");
  });
});
