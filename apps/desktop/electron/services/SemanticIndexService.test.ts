import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  SemanticIndexService,
  createLocalSemanticVector,
  semanticVectorSimilarity,
  tokenizeSemanticText
} from "./SemanticIndexService.js";
import { ProjectService } from "./ProjectService.js";

const created: string[] = [];

afterEach(async () => {
  for (const directory of created.splice(0)) {
    if (path.resolve(directory).startsWith(path.resolve(os.tmpdir()))) {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

describe("local semantic vectors", () => {
  it("tokenizes Chinese into characters and bigrams", () => {
    expect(tokenizeSemanticText("星门开启")).toEqual(expect.arrayContaining(["星", "门", "开启", "星门", "门开"]));
  });

  it("ranks related Chinese passages above unrelated passages", () => {
    const query = createLocalSemanticVector("城门开启的代价");
    const related = createLocalSemanticVector("主角必须付出代价才能打开月之城门");
    const unrelated = createLocalSemanticVector("早餐桌上放着热牛奶和面包");

    expect(semanticVectorSimilarity(query, related)).toBeGreaterThan(semanticVectorSimilarity(query, unrelated));
  });

  it("indexes a local project and returns chapter sources", async () => {
    const parentPath = await mkdtemp(path.join(os.tmpdir(), "inkforge-semantic-"));
    created.push(parentPath);
    const projects = new ProjectService();
    const project = await projects.createProject(parentPath, {
      title: "语义检索测试",
      author: "tester",
      genre: [],
      targetWords: 100_000,
      style: "简洁",
      protagonist: "",
      premise: ""
    });
    project.outline.premise = "失落航线背后隐藏着港口旧案";
    project.outline.volumes[0].chapters[0].goal = "顾言寻找遗失的航海日志";
    await projects.updateOutline({ projectPath: project.projectPath, outline: project.outline });

    const result = await new SemanticIndexService().search(project.projectPath, "顾言为什么寻找航海日志", 4);

    expect(result.indexedDocuments).toBeGreaterThan(0);
    expect(result.hits.some((hit) => hit.kind === "chapter" && hit.id === "ch-0001")).toBe(true);

    const outlineResult = await new SemanticIndexService().search(project.projectPath, "港口旧案", 4);
    expect(outlineResult.hits.some((hit) => hit.kind === "outline")).toBe(true);
  });
});
