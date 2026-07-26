import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { __electronMock } from "electron";

const secret = "sk-smoke-secret-do-not-write-to-project";
const root = await mkdtemp(path.join(os.tmpdir(), "inkforge-desktop-smoke-"));
const userData = path.join(root, "user-data");
process.env.INKFORGE_SMOKE_USER_DATA = userData;
process.env.INKFORGE_SMOKE_OPEN_DIALOG_PATH = root;

await import("../apps/desktop/dist-electron/main.js");
await new Promise((resolve) => setTimeout(resolve, 0));

try {
  const project = await __electronMock.invoke("project:create", {
    title: "SmokeNovel",
    author: "Smoke Tester",
    genre: ["smoke"],
    targetWords: 6000,
    style: "plain direct prose",
    protagonist: "A writer",
    premise: "A local-first smoke test verifies file behavior."
  });
  assert.ok(project?.projectPath, "project:create IPC should return a project");
  const firstChapter = project.outline.volumes[0].chapters[0];
  const chapterText =
    '# Smoke Chapter\n\nThe editor saves durable chapter text.\n\n---\n\n<script src="https://example.invalid/evil.js"></script>\n';
  await __electronMock.invoke("chapter:save", {
    projectPath: project.projectPath,
    file: firstChapter.file,
    content: "# Smoke Chapter\n\nInitial text before history.\n"
  });
  await __electronMock.invoke("chapter:save", {
    projectPath: project.projectPath,
    file: firstChapter.file,
    content: chapterText
  });
  assert.ok((await __electronMock.invoke("chapter:history:list", project.projectPath, firstChapter.file)).length >= 1);

  const reopened = await __electronMock.invoke("project:open", project.projectPath);
  assert.equal(reopened.meta.title, "SmokeNovel");
  assert.equal(await __electronMock.invoke("chapter:read", project.projectPath, firstChapter.file), chapterText);
  assert.equal((await __electronMock.invoke("project:list"))[0]?.projectPath, project.projectPath);

  for (const format of ["markdown", "txt", "docx", "epub"]) {
    const exportPath = await __electronMock.invoke("export:manuscript", {
      projectPath: project.projectPath,
      format,
      includeChapterTitles: true,
      includeVolumeTitles: true,
      epub:
        format === "epub"
          ? {
              title: "Smoke Novel",
              author: "Smoke Tester",
              language: "en",
              description: "EPUB smoke test",
              cssTheme: "modern"
            }
          : undefined
    });
    assert.ok(exportPath, `${format} export should return a path`);
    assert.ok((await stat(exportPath)).size > 0, `${format} export should write a non-empty file`);
    if (format === "epub") {
      const epub = await readFile(exportPath);
      assert.equal(epub.subarray(30, 38).toString("utf8"), "mimetype");
      assert.equal(epub.readUInt16LE(8), 0, "EPUB mimetype entry must be stored without compression");
      const archive = unzipSync(epub);
      const sections = Object.entries(archive)
        .filter(([name]) => name.startsWith("OEBPS/text/"))
        .map(([, content]) => strFromU8(content))
        .join("\n");
      assert.match(sections, /<hr \/>/u);
      assert.doesNotMatch(sections, /<script\b/iu);
    }
  }

  const manualBackup = await __electronMock.invoke("backup:create", project.projectPath, "Smoke restore point");
  await __electronMock.invoke("chapter:save", {
    projectPath: project.projectPath,
    file: firstChapter.file,
    content: "# Changed after backup\n"
  });
  await __electronMock.invoke("backup:restore", project.projectPath, manualBackup.id);
  assert.equal(await __electronMock.invoke("chapter:read", project.projectPath, firstChapter.file), chapterText);
  assert.ok(
    (await __electronMock.invoke("backup:list", project.projectPath)).some((item) => item.reason === "before-restore")
  );

  await __electronMock.invoke("writing-workspace:save", project.projectPath, {
    annotations: [],
    bookmarks: [],
    sessions: [
      {
        id: "smoke-session",
        chapterId: firstChapter.id,
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        wordsAdded: 12,
        durationSeconds: 60
      }
    ]
  });
  assert.equal((await __electronMock.invoke("writing-workspace:load", project.projectPath)).sessions[0].wordsAdded, 12);

  await __electronMock.invoke("agent-extensions:save", project.projectPath, {
    promptPresets: [],
    toolProfiles: [],
    customTools: [
      {
        id: "smoke-tool",
        name: "Smoke Tool",
        description: "",
        instruction: "Inspect the chapter.",
        allowedTools: ["get_chapter_context"]
      }
    ]
  });
  assert.equal(
    (await __electronMock.invoke("agent-extensions:load", project.projectPath)).customTools[0].name,
    "Smoke Tool"
  );

  const status = await __electronMock.invoke("provider:save", {
    providerId: "smoke-provider",
    displayName: "Smoke Provider",
    baseUrl: "http://127.0.0.1:1/v1",
    model: "smoke-model",
    authMode: "bearer",
    apiKey: secret,
    temperature: 0.2,
    maxTokens: 128
  });
  assert.equal(status.configured, true);
  assert.ok(status.maskedKey?.startsWith("sk-smo"), "provider status should only expose a masked key");
  assert.equal((await __electronMock.invoke("provider:status")).configured, true);

  const projectBytes = await readTree(project.projectPath);
  assert.equal(projectBytes.includes(secret), false, "provider API key must not be written into the project directory");
  const secureConfigText = await readFile(path.join(userData, "provider-config.secure.json"), "utf8");
  assert.equal(
    secureConfigText.includes(secret),
    false,
    "secure provider file should not contain the plaintext API key"
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        projectPath: project.projectPath,
        checked: [
          "register and invoke desktop IPC handlers",
          "create project",
          "write and reopen chapter",
          "chapter save history",
          "export markdown/txt/docx/epub",
          "backup create and protected restore",
          "writing annotations/session storage",
          "Agent extension storage",
          "provider secret outside project directory"
        ]
      },
      null,
      2
    )
  );
} finally {
  await rm(root, { recursive: true, force: true });
}

async function readTree(dir) {
  const chunks = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      chunks.push(Buffer.from(await readTree(fullPath), "utf8"));
    } else if (entry.isFile()) {
      chunks.push(await readFile(fullPath));
    }
  }
  return Buffer.concat(chunks).toString("utf8");
}
