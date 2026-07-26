import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { inkforgeSchemaVersion } from "@inkforge/schemas";
import { ProjectService, sanitizeLegacyOutline, suggestChapterTitle } from "./ProjectService.js";

describe("automatic chapter titles", () => {
  it("uses the previous chapter hook as context", () => {
    expect(
      suggestChapterTitle(2, {
        hook: "黑匣中传出第二个人的心跳声，林烬决定追查来源。",
        goal: "主角离开边城"
      })
    ).toBe("第2章 黑匣中传出第二个人的心跳声");
  });

  it("falls back to a usable offline title instead of 未命名", () => {
    const title = suggestChapterTitle(3, {
      hook: "用一个明确问题推动读者进入下一章",
      goal: "建立主角、冲突与第一处悬念"
    });

    expect(title).toBe("第3章 旧事回响");
    expect(title).not.toContain("未命名");
  });

  it("does not reuse generic setup instructions as a chapter name", () => {
    expect(
      suggestChapterTitle(2, {
        hook: "用一个明确问题推动读者进入下一章",
        goal: "介绍主角：林烬，边城少年，寻找失踪父亲"
      })
    ).toBe("第2章 暗流初现");
  });
});

describe("blank project initialization", () => {
  it("refuses to overwrite an existing project folder with the same title", async () => {
    const parentDir = await mkdtemp(path.join(os.tmpdir(), "inkforge-project-conflict-"));
    try {
      const service = new ProjectService();
      const input = {
        title: "同名项目",
        author: "作者",
        genre: [],
        targetWords: 300_000,
        style: "",
        protagonist: "",
        premise: ""
      };
      const project = await service.createProject(parentDir, input);
      const firstChapter = project.outline.volumes[0].chapters[0];
      const chapterPath = path.join(project.projectPath, firstChapter.file);
      await writeFile(chapterPath, "# 不可覆盖\n\n已有正文", "utf8");

      await expect(service.createProject(parentDir, input)).rejects.toThrow(/目标项目文件夹已存在/u);
      expect(await readFile(chapterPath, "utf8")).toBe("# 不可覆盖\n\n已有正文");
    } finally {
      await rm(parentDir, { recursive: true, force: true });
    }
  });

  it("does not seed fictional characters, world facts or chapter goals", async () => {
    const parentDir = await mkdtemp(path.join(os.tmpdir(), "inkforge-blank-project-"));
    try {
      const project = await new ProjectService().createProject(parentDir, {
        title: "正式项目",
        author: "作者",
        genre: [],
        targetWords: 300_000,
        style: "",
        protagonist: "",
        premise: ""
      });
      const firstChapter = project.outline.volumes[0].chapters[0];
      expect(firstChapter.goal).toBe("");
      expect(firstChapter.hook).toBe("");
      expect(project.outline.premise).toBe("");
      expect(project.outline.volumes[0].goal).toBe("");
      expect(await readdir(path.join(project.projectPath, "characters"))).toEqual([]);
      expect((await readdir(path.join(project.projectPath, "world"))).sort()).toEqual([
        "factions.json",
        "locations.json"
      ]);
      expect(await readFile(path.join(project.projectPath, firstChapter.file), "utf8")).toBe("");
    } finally {
      await rm(parentDir, { recursive: true, force: true });
    }
  });

  it("creates chapter files introduced by an outline update", async () => {
    const parentDir = await mkdtemp(path.join(os.tmpdir(), "inkforge-outline-update-"));
    try {
      const service = new ProjectService();
      const project = await service.createProject(parentDir, {
        title: "大纲写入测试",
        author: "作者",
        genre: [],
        targetWords: 300_000,
        style: "",
        protagonist: "",
        premise: ""
      });
      const secondChapter = {
        ...project.outline.volumes[0].chapters[0],
        id: "ch-0002",
        number: 2,
        title: "第二章 北站来客",
        file: "chapters/volume-001/ch-0002.md"
      };

      await service.updateOutline({
        projectPath: project.projectPath,
        outline: {
          ...project.outline,
          volumes: [
            {
              ...project.outline.volumes[0],
              chapters: [...project.outline.volumes[0].chapters, secondChapter]
            }
          ]
        }
      });

      expect(await readFile(path.join(project.projectPath, secondChapter.file), "utf8")).toBe("");
    } finally {
      await rm(parentDir, { recursive: true, force: true });
    }
  });

  it("removes only the exact legacy demo outline fields", () => {
    const cleaned = sanitizeLegacyOutline({
      schemaVersion: inkforgeSchemaVersion,
      premise: "边城少年得到父亲留下的黑匣，发现自身血脉与失落星火有关。",
      mainConflict: "作者自己的冲突",
      endingDirection: "",
      volumes: [
        {
          id: "vol-001",
          title: "第一卷",
          goal: "建立世界、主角动机与核心冲突",
          targetWords: 90_000,
          chapters: [
            {
              id: "ch-0001",
              number: 1,
              title: "第一章",
              file: "chapters/volume-001/ch-0001.md",
              goal: "介绍主角：林烬，边城少年，寻找失踪父亲",
              hook: "用一个明确问题推动读者进入下一章",
              status: "drafting",
              targetWords: 3_000,
              actualWords: 0,
              archived: false,
              notes: "",
              conflictPoints: "",
              characters: [],
              worldRefs: []
            }
          ]
        }
      ]
    });

    expect(cleaned.premise).toBe("");
    expect(cleaned.mainConflict).toBe("作者自己的冲突");
    expect(cleaned.volumes[0].goal).toBe("");
    expect(cleaned.volumes[0].chapters[0].goal).toBe("");
    expect(cleaned.volumes[0].chapters[0].hook).toBe("");
  });
});
