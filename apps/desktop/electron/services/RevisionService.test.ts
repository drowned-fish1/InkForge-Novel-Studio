import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ChatAgentService } from "./ChatAgentService.js";
import { FileRepository } from "./FileRepository.js";
import { LibraryService } from "./LibraryService.js";
import { ProjectService } from "./ProjectService.js";
import { QualityService } from "./QualityService.js";
import { RevisionService } from "./RevisionService.js";
import { StoryStateService } from "./StoryStateService.js";
import { WorkspaceService } from "./WorkspaceService.js";

const temporaryRoots: string[] = [];

const createServices = () => {
  const files = new FileRepository();
  const projects = new ProjectService(files);
  const workspace = new WorkspaceService(files);
  const library = new LibraryService(files);
  const story = new StoryStateService(files, projects);
  const quality = new QualityService(files, projects, story);
  const mockAi = {
    runAgentCompletion: async () => {
      throw new Error("AI must not be called for local revision aggregation.");
    },
    cancelTask: () => undefined
  };
  const chatAgent = new ChatAgentService(files, projects, library, story, mockAi as never);
  const revisions = new RevisionService(files, projects, workspace, quality, story, chatAgent);
  return { projects, workspace, quality, revisions };
};

const createProjectFixture = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inkforge-revision-"));
  temporaryRoots.push(root);
  return root;
};

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("RevisionService", () => {
  it("aggregates annotations, quality findings and continuity issues without AI", async () => {
    const root = await createProjectFixture();
    const { projects, workspace, quality, revisions } = createServices();
    const project = await projects.createProject(root, {
      title: "修订测试",
      author: "tester",
      genre: [],
      targetWords: 100000,
      style: "",
      protagonist: "",
      premise: ""
    });
    const chapter = project.outline.volumes[0].chapters[0];

    await workspace.saveWritingWorkspace(project.projectPath, {
      annotations: [
        {
          id: "annotation-1",
          chapterId: chapter.id,
          start: 0,
          end: 4,
          quote: "开场句",
          note: "语气再冷一点",
          color: "rose",
          kind: "revision",
          status: "open",
          createdAt: "2026-07-27T00:00:00.000Z"
        }
      ],
      bookmarks: [],
      sessions: [],
      fragments: []
    });
    await quality.evaluateChapter(project.projectPath, chapter.id);

    const overview = await revisions.overview(project.projectPath);
    expect(overview.annotations).toHaveLength(1);
    expect(overview.annotations[0].chapterTitle).toBe(chapter.title);
    expect(overview.qualityReports).toHaveLength(1);
    expect(overview.qualityReports[0].chapterId).toBe(chapter.id);
    expect(overview.qualityReports[0].findings.length).toBeGreaterThan(0);
    expect(Array.isArray(overview.continuityIssues)).toBe(true);
    expect(overview.proposals).toEqual([]);
    expect(overview.revisionState.dispositions).toEqual([]);
  });

  it("persists and upserts dispositions", async () => {
    const root = await createProjectFixture();
    const { projects, revisions } = createServices();
    const project = await projects.createProject(root, {
      title: "处置测试",
      author: "tester",
      genre: [],
      targetWords: 100000,
      style: "",
      protagonist: "",
      premise: ""
    });

    await revisions.setDisposition(project.projectPath, "quality:ch-0001:pacing:章节体量偏短", "ignored");
    let state = await revisions.setDisposition(project.projectPath, "continuity:x", "deferred", "等下一卷");
    expect(state.dispositions).toHaveLength(2);

    state = await revisions.setDisposition(project.projectPath, "continuity:x", "accepted");
    expect(state.dispositions).toHaveLength(2);
    expect(state.dispositions.find((item) => item.key === "continuity:x")?.status).toBe("accepted");

    const overview = await revisions.overview(project.projectPath);
    expect(overview.revisionState.dispositions).toHaveLength(2);
  });
});
