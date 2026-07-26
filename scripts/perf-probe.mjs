// Performance probe: generates a large web-novel-scale project against the
// REAL built main process (same mock-electron loader as desktop-smoke) and
// times the hot paths that scale with chapter count.
//
//   node --loader ./scripts/mock-electron-loader.mjs ./scripts/perf-probe.mjs
//
// Env: PERF_VOLUMES (default 4), PERF_CHAPTERS_PER_VOLUME (default 100),
//      PERF_CHARS_PER_CHAPTER (default 7000)
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { __electronMock } from "electron";

const volumeCount = Number(process.env.PERF_VOLUMES ?? 4);
const chaptersPerVolume = Number(process.env.PERF_CHAPTERS_PER_VOLUME ?? 100);
const charsPerChapter = Number(process.env.PERF_CHARS_PER_CHAPTER ?? 7000);
const totalChapters = volumeCount * chaptersPerVolume;

const root = await mkdtemp(path.join(os.tmpdir(), "inkforge-perf-"));
process.env.INKFORGE_SMOKE_USER_DATA = path.join(root, "user-data");
process.env.INKFORGE_SMOKE_OPEN_DIALOG_PATH = root;

await import("../apps/desktop/dist-electron/main.js");
await new Promise((resolve) => setTimeout(resolve, 0));

const timings = {};
const time = async (label, fn) => {
  const start = performance.now();
  const result = await fn();
  timings[label] = Math.round(performance.now() - start);
  return result;
};

const paragraph = (chapterIndex, paragraphIndex) =>
  `第${chapterIndex}章第${paragraphIndex}段：他沿着湿冷的巷子走下去，雨声盖过了身后的脚步。储物柜的编号在脑子里反复出现，直到路灯熄灭的那一刻。`;

const chapterContent = (chapterIndex) => {
  const parts = [];
  let length = 0;
  let p = 0;
  while (length < charsPerChapter) {
    const text = paragraph(chapterIndex, (p += 1));
    parts.push(text);
    length += text.length + 2;
  }
  return parts.join("\n\n");
};

try {
  const project = await time("project:create", () =>
    __electronMock.invoke("project:create", {
      title: "PerfNovel",
      author: "Perf Tester",
      genre: ["perf"],
      targetWords: totalChapters * charsPerChapter,
      style: "",
      protagonist: "",
      premise: "large project probe"
    })
  );

  // Build the full outline in one update (per-chapter createChapter IPC would
  // be O(n^2) on outline rewrites and is not how imports work either).
  let chapterNumber = 0;
  const volumes = Array.from({ length: volumeCount }, (_, volumeIndex) => ({
    id: `vol-${String(volumeIndex + 1).padStart(3, "0")}`,
    title: `第${volumeIndex + 1}卷`,
    goal: "",
    targetWords: chaptersPerVolume * charsPerChapter,
    chapters: Array.from({ length: chaptersPerVolume }, () => {
      chapterNumber += 1;
      return {
        id: `ch-${String(chapterNumber).padStart(4, "0")}`,
        number: chapterNumber,
        title: `第${chapterNumber}章 巷战与车票`,
        file: `chapters/volume-${String(volumeIndex + 1).padStart(3, "0")}/ch-${String(chapterNumber).padStart(4, "0")}.md`,
        goal: "",
        hook: "",
        status: "drafting",
        targetWords: charsPerChapter,
        actualWords: charsPerChapter,
        archived: false,
        notes: "",
        conflictPoints: "",
        characters: [],
        worldRefs: []
      };
    })
  }));
  const outline = { ...project.outline, volumes };
  await time("outline:update (full, N chapters)", () =>
    __electronMock.invoke("outline:update", { projectPath: project.projectPath, outline })
  );

  await time(`chapter:save x${totalChapters}`, async () => {
    for (const volume of volumes) {
      for (const chapter of volume.chapters) {
        await __electronMock.invoke("chapter:save", {
          projectPath: project.projectPath,
          file: chapter.file,
          content: chapterContent(chapter.number)
        });
      }
    }
  });

  const reopened = await time("project:open (reopen)", () =>
    __electronMock.invoke("project:open", project.projectPath)
  );
  if (reopened.outline.volumes.flatMap((volume) => volume.chapters).length !== totalChapters) {
    throw new Error("reopened project lost chapters");
  }

  const editedOutline = structuredClone(reopened.outline);
  editedOutline.volumes[0].chapters[0].title = "第1章 巷战与车票（改）";
  await time("outline:update (single title edit)", () =>
    __electronMock.invoke("outline:update", { projectPath: project.projectPath, outline: editedOutline })
  );

  const snapshot = await time("backup:create (full copy)", () =>
    __electronMock.invoke("backup:create", project.projectPath, "perf")
  );
  timings["backup size (MB)"] = Math.round((snapshot.size / 1024 / 1024) * 10) / 10;
  await time("backup:verify", () => __electronMock.invoke("backup:verify", project.projectPath, snapshot.id));
  await time("backup:diff", () => __electronMock.invoke("backup:diff", project.projectPath, snapshot.id));

  await time("revision:overview", () => __electronMock.invoke("revision:overview", project.projectPath));

  const files = reopened.outline.volumes.flatMap((volume) => volume.chapters.map((chapter) => chapter.file));
  await time("chapter:history:overview (all)", () =>
    __electronMock.invoke("chapter:history:overview", project.projectPath, files)
  );

  await time("export:preflight", () => __electronMock.invoke("export:preflight", project.projectPath));

  await time("quality:evaluate x20", async () => {
    for (const chapter of reopened.outline.volumes[0].chapters.slice(0, 20)) {
      await __electronMock.invoke("quality:evaluate", project.projectPath, chapter.id);
    }
  });

  await time("revision:overview (after quality)", () =>
    __electronMock.invoke("revision:overview", project.projectPath)
  );

  await time("story:entity:references (character probe)", async () => {
    await __electronMock.invoke("library:characters:save", {
      projectPath: project.projectPath,
      character: {
        id: "perf-char",
        name: "林烬",
        aliases: [],
        role: "protagonist",
        tags: [],
        profile: { age: "", identity: "", motivation: "", personality: "" },
        currentState: { arc: "", powerLevel: "", location: "", relationships: [], secrets: [] },
        voiceNotes: ""
      }
    });
    await __electronMock.invoke("story:entity:references", project.projectPath, {
      kind: "character",
      id: "perf-char"
    });
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        scale: { volumes: volumeCount, chapters: totalChapters, charsPerChapter },
        timingsMs: timings
      },
      null,
      2
    )
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
