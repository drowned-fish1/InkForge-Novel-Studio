import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileRepository } from "./FileRepository.js";
import { LibraryService } from "./LibraryService.js";
import { ProjectService } from "./ProjectService.js";
import { StoryReferenceService } from "./StoryReferenceService.js";
import { StoryStateService } from "./StoryStateService.js";

const temporaryRoots: string[] = [];

const createFixture = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inkforge-rename-"));
  temporaryRoots.push(root);
  const files = new FileRepository();
  const projects = new ProjectService(files);
  const library = new LibraryService(files);
  const story = new StoryStateService(files, projects);
  const references = new StoryReferenceService(files, projects, library, story);
  const project = await projects.createProject(root, {
    title: "改名测试",
    author: "tester",
    genre: [],
    targetWords: 100000,
    style: "",
    protagonist: "",
    premise: ""
  });
  return { files, projects, library, story, references, project };
};

const character = (id: string, name: string, relationships: string[] = []) => ({
  id,
  name,
  aliases: [],
  role: "supporting",
  tags: [],
  profile: { age: "", identity: "", motivation: "", personality: "" },
  currentState: { arc: "", powerLevel: "", location: "", relationships, secrets: [] },
  voiceNotes: ""
});

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("StoryReferenceService rename sync", () => {
  it("propagates a character rename to conflicts, events, world entries, relations and chapters", async () => {
    const { library, story, references, projects, project } = await createFixture();
    await library.saveCharacter(project.projectPath, character("char-lin", "林烬"));
    await library.saveCharacter(project.projectPath, character("char-su", "苏禾", ["信任林烬"]));
    await library.saveWorldEntry(project.projectPath, {
      id: "loc-1",
      title: "旧车站",
      type: "location",
      locked: false,
      tags: [],
      summary: "",
      content: "",
      relatedCharacters: ["林烬"],
      relatedClues: []
    });
    await story.saveTimelineEvent(project.projectPath, {
      id: "ev-1",
      order: 1,
      title: "接头",
      location: "旧车站",
      participants: ["林烬"],
      summary: ""
    });
    await story.saveConflict(project.projectPath, {
      id: "conf-1",
      title: "车票之争",
      kind: "main",
      status: "active",
      parties: ["林烬", "缉私队"],
      stakes: "",
      relatedCharacters: ["林烬"],
      relatedFactions: [],
      chapterIds: [],
      summary: "",
      notes: ""
    });
    const chapter = project.outline.volumes[0].chapters[0];
    await projects.updateOutline({
      projectPath: project.projectPath,
      outline: {
        ...project.outline,
        volumes: project.outline.volumes.map((volume) => ({
          ...volume,
          chapters: volume.chapters.map((item) => (item.id === chapter.id ? { ...item, characters: ["林烬"] } : item))
        }))
      }
    });

    const characters = await references.saveCharacterWithRenameSync(project.projectPath, character("char-lin", "陆离"));

    expect(characters.find((item) => item.id === "char-lin")?.name).toBe("陆离");
    expect(characters.find((item) => item.id === "char-su")?.currentState.relationships).toEqual(["信任陆离"]);
    expect((await library.listWorldEntries(project.projectPath))[0].relatedCharacters).toEqual(["陆离"]);
    expect((await story.listTimeline(project.projectPath))[0].participants).toEqual(["陆离"]);
    const conflict = (await story.listConflicts(project.projectPath))[0];
    expect(conflict.parties).toEqual(["陆离", "缉私队"]);
    expect(conflict.relatedCharacters).toEqual(["陆离"]);
    const reopened = await projects.openProject(project.projectPath);
    expect(reopened.outline.volumes[0].chapters.find((item) => item.id === chapter.id)?.characters).toEqual(["陆离"]);
  });

  it("propagates a world-entry title rename including scalar location fields", async () => {
    const { library, story, references, project } = await createFixture();
    await library.saveWorldEntry(project.projectPath, {
      id: "loc-1",
      title: "旧车站",
      type: "location",
      locked: false,
      tags: [],
      summary: "",
      content: "",
      relatedCharacters: [],
      relatedClues: []
    });
    await library.saveCharacter(project.projectPath, {
      ...character("char-lin", "林烬"),
      currentState: { arc: "", powerLevel: "", location: "旧车站", relationships: [], secrets: [] }
    });
    await story.saveTimelineEvent(project.projectPath, {
      id: "ev-1",
      order: 1,
      title: "接头",
      location: "旧车站",
      participants: [],
      summary: ""
    });

    await references.saveWorldEntryWithRenameSync(project.projectPath, {
      id: "loc-1",
      title: "废弃车站",
      type: "location",
      locked: false,
      tags: [],
      summary: "",
      content: "",
      relatedCharacters: [],
      relatedClues: []
    });

    expect((await library.listCharacters(project.projectPath))[0].currentState.location).toBe("废弃车站");
    expect((await story.listTimeline(project.projectPath))[0].location).toBe("废弃车站");
  });

  it("does nothing extra when the name is unchanged", async () => {
    const { library, references, project } = await createFixture();
    await library.saveCharacter(project.projectPath, character("char-lin", "林烬"));
    await library.saveCharacter(project.projectPath, character("char-su", "苏禾", ["信任林烬"]));
    await references.saveCharacterWithRenameSync(project.projectPath, {
      ...character("char-lin", "林烬"),
      voiceNotes: "只改备注"
    });
    expect(
      (await library.listCharacters(project.projectPath)).find((item) => item.id === "char-su")?.currentState
        .relationships
    ).toEqual(["信任林烬"]);
  });
});
