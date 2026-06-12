import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
  const chapterText = "# Smoke Chapter\n\nThe editor saves durable chapter text.\n";
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

  for (const format of ["markdown", "txt", "docx"]) {
    const exportPath = await __electronMock.invoke("export:manuscript", {
      projectPath: project.projectPath,
      format,
      includeChapterTitles: true,
      includeVolumeTitles: true
    });
    assert.ok(exportPath, `${format} export should return a path`);
    assert.ok((await stat(exportPath)).size > 0, `${format} export should write a non-empty file`);
  }

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
          "export markdown/txt/docx",
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
