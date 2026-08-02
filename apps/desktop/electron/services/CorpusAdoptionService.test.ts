import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CorpusAdoptionService } from "./CorpusAdoptionService.js";
import { CorpusImportService } from "./CorpusImportService.js";
import { FileRepository } from "./FileRepository.js";
import { ProjectService } from "./ProjectService.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("CorpusAdoptionService", () => {
  it("materializes imported chapters into the editable project and is idempotent", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "inkforge-adopt-"));
    roots.push(parent);
    const source = path.join(parent, "source.txt");
    await writeFile(source, "第一章 归来\n旧门还锁着。\n第二章 钥匙\n她交出了钥匙。", "utf8");
    const files = new FileRepository();
    const projects = new ProjectService(files);
    const project = await projects.createProject(parent, {
      title: "采纳测试",
      author: "author",
      genre: [],
      targetWords: 100_000,
      style: "",
      protagonist: "",
      premise: ""
    });
    const imports = new CorpusImportService(files);
    const manifest = await imports.import({ projectPath: project.projectPath, sourcePath: source });
    const service = new CorpusAdoptionService(files, projects, imports);
    const first = await service.adopt({ projectPath: project.projectPath, importId: manifest.id, volumeSize: 20 });
    expect(first.adoptedChapters).toBe(2);
    const reopened = await projects.openProject(project.projectPath);
    const adopted = reopened.outline.volumes
      .flatMap((volume) => volume.chapters)
      .filter((chapter) => chapter.notes.includes("[corpus:"));
    expect(adopted).toHaveLength(2);
    expect(await files.readText(files.assertInsideProject(project.projectPath, adopted[1].file))).toContain("钥匙");
    const second = await service.adopt({ projectPath: project.projectPath, importId: manifest.id });
    expect(second.adoptedChapters).toBe(0);
    expect(second.alreadyAdopted).toBe(2);
  });

  it("rejects adoption before an import completes", async () => {
    const service = new CorpusAdoptionService(
      new FileRepository(),
      { openProject: async () => ({}) } as never,
      { get: async () => ({ status: "paused" }) } as never
    );
    await expect(service.adopt({ projectPath: "project", importId: "import" })).rejects.toThrow("已经完成");
  });
});
