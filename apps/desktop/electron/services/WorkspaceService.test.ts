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
          kind: "comment",
          status: "open",
          createdAt: "2026-07-24T00:00:00.000Z"
        }
      ],
      bookmarks: [],
      sessions: [],
      fragments: [
        {
          id: "fragment-1",
          title: "灵感",
          content: "一段不属于任何章节的桥段",
          tags: ["支线"],
          archived: false,
          createdAt: "2026-07-24T00:00:00.000Z",
          updatedAt: "2026-07-24T00:00:00.000Z"
        }
      ]
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

    const workspace = await service.loadWritingWorkspace(projectPath);
    expect(workspace.annotations[0].note).toBe("再加强");
    expect(workspace.fragments[0].title).toBe("灵感");
    expect((await service.loadAgentExtensions(projectPath)).toolProfiles[0].name).toBe("只读检查");
  });
});

describe("WorkspaceService backup settings and integrity", () => {
  it("persists backup settings and rejects a directory inside the project", async () => {
    const projectPath = await createProjectFixture();
    const service = new WorkspaceService();

    const defaults = await service.loadBackupSettings(projectPath);
    expect(defaults.automaticIntervalMinutes).toBe(10);
    expect(defaults.maxAutomaticSnapshots).toBe(20);
    expect(defaults.maxTotalSizeMb).toBe(512);

    const saved = await service.saveBackupSettings(projectPath, {
      ...defaults,
      automaticIntervalMinutes: 5,
      maxAutomaticSnapshots: 3
    });
    expect(saved.automaticIntervalMinutes).toBe(5);
    expect((await service.loadBackupSettings(projectPath)).maxAutomaticSnapshots).toBe(3);

    await expect(
      service.saveBackupSettings(projectPath, { ...defaults, backupDirectory: path.join(projectPath, "inner") })
    ).rejects.toThrow("项目文件夹内部");
    await expect(
      service.saveBackupSettings(projectPath, { ...defaults, backupDirectory: "relative/path" })
    ).rejects.toThrow("绝对路径");
  });

  it("records chapter hashes and changed chapters between snapshots", async () => {
    const projectPath = await createProjectFixture();
    const service = new WorkspaceService();
    const chapterDir = path.join(projectPath, "chapters", "volume-001");
    await mkdir(chapterDir, { recursive: true });
    await writeFile(path.join(chapterDir, "ch-0001.md"), "第一章正文", "utf8");

    const first = await service.createBackup(projectPath, "manual");
    expect(Object.keys(first.chapterHashes)).toEqual(["chapters/volume-001/ch-0001.md"]);
    expect(first.changedChapterFiles).toEqual(["chapters/volume-001/ch-0001.md"]);

    await writeFile(path.join(chapterDir, "ch-0001.md"), "第一章正文（修改后）", "utf8");
    await writeFile(path.join(chapterDir, "ch-0002.md"), "第二章", "utf8");
    const second = await service.createBackup(projectPath, "manual");
    expect(second.changedChapterFiles.sort()).toEqual([
      "chapters/volume-001/ch-0001.md",
      "chapters/volume-001/ch-0002.md"
    ]);
  });

  it("verifies snapshot integrity and detects tampering", async () => {
    const projectPath = await createProjectFixture();
    const service = new WorkspaceService();
    const chapterDir = path.join(projectPath, "chapters", "volume-001");
    await mkdir(chapterDir, { recursive: true });
    await writeFile(path.join(chapterDir, "ch-0001.md"), "原始正文", "utf8");
    const snapshot = await service.createBackup(projectPath, "manual");

    const clean = await service.verifyBackup(projectPath, snapshot.id);
    expect(clean.ok).toBe(true);

    const inspection = await service.inspectBackups(projectPath);
    const tamperedPath = path.join(
      inspection.backupRoot,
      snapshot.id,
      "project",
      "chapters",
      "volume-001",
      "ch-0001.md"
    );
    await writeFile(tamperedPath, "被篡改的内容", "utf8");
    const tampered = await service.verifyBackup(projectPath, snapshot.id);
    expect(tampered.ok).toBe(false);
    expect(tampered.issues.join(" ")).toContain("ch-0001.md");
  });

  it("summarizes a restore diff and reads snapshot files safely", async () => {
    const projectPath = await createProjectFixture();
    const service = new WorkspaceService();
    const chapterDir = path.join(projectPath, "chapters", "volume-001");
    await mkdir(chapterDir, { recursive: true });
    await writeFile(path.join(chapterDir, "ch-0001.md"), "旧内容", "utf8");
    await writeFile(path.join(chapterDir, "ch-0002.md"), "将被删除", "utf8");
    const snapshot = await service.createBackup(projectPath, "manual");

    await writeFile(path.join(chapterDir, "ch-0001.md"), "新内容", "utf8");
    await rm(path.join(chapterDir, "ch-0002.md"));
    await writeFile(path.join(chapterDir, "ch-0003.md"), "快照之后新增", "utf8");

    const diff = await service.diffBackup(projectPath, snapshot.id);
    expect(diff.modifiedChapters).toEqual(["chapters/volume-001/ch-0001.md"]);
    expect(diff.removedChapters).toEqual(["chapters/volume-001/ch-0002.md"]);
    expect(diff.addedChapters).toEqual(["chapters/volume-001/ch-0003.md"]);

    expect(await service.readBackupFile(projectPath, snapshot.id, "chapters/volume-001/ch-0001.md")).toBe("旧内容");
    await expect(service.readBackupFile(projectPath, snapshot.id, "../../outline.json")).rejects.toThrow(
      "Blocked path"
    );
  });

  it("keeps backup settings after a restore", async () => {
    const projectPath = await createProjectFixture();
    const service = new WorkspaceService();
    const snapshot = await service.createBackup(projectPath, "manual");
    const defaults = await service.loadBackupSettings(projectPath);
    await service.saveBackupSettings(projectPath, { ...defaults, automaticIntervalMinutes: 45 });

    await service.restoreBackup(projectPath, snapshot.id);

    expect((await service.loadBackupSettings(projectPath)).automaticIntervalMinutes).toBe(45);
  });

  it("evicts oldest automatic snapshots when the disk cap is exceeded", async () => {
    const projectPath = await createProjectFixture();
    const service = new WorkspaceService();
    const chapterDir = path.join(projectPath, "chapters");
    await mkdir(chapterDir, { recursive: true });
    // ~4MB chapter (CJK chars are 3 bytes in UTF-8), so each snapshot is ~4MB
    // and the third snapshot pushes the total past a 10MB cap.
    await writeFile(path.join(chapterDir, "ch-0001.md"), "正".repeat(1_400_000), "utf8");
    const defaults = await service.loadBackupSettings(projectPath);
    await service.saveBackupSettings(projectPath, { ...defaults, maxTotalSizeMb: 10 });

    const first = await service.createBackup(projectPath, "automatic", "第一份");
    const second = await service.createBackup(projectPath, "automatic", "第二份");
    const third = await service.createBackup(projectPath, "automatic", "第三份");

    const after = await service.listBackups(projectPath);
    expect(after.some((item) => item.id === third.id)).toBe(true);
    expect(after.some((item) => item.id === second.id)).toBe(true);
    expect(after.some((item) => item.id === first.id)).toBe(false);
  });
});
