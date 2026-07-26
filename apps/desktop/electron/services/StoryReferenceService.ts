import {
  detachStoryReferences,
  findStoryReferences,
  type StoryDetachMode,
  type StoryEntityRef,
  type StoryReferenceData,
  type StoryReferenceHit
} from "@inkforge/schemas";
import { FileRepository } from "./FileRepository.js";
import { LibraryService } from "./LibraryService.js";
import { ProjectService } from "./ProjectService.js";
import { StoryStateService } from "./StoryStateService.js";

/**
 * Cross-entity reference checks for delete flows. Reference matching and
 * rewriting is shared with the browser mirror via @inkforge/schemas.
 */
export class StoryReferenceService {
  constructor(
    private readonly files = new FileRepository(),
    private readonly projects = new ProjectService(files),
    private readonly library = new LibraryService(files),
    private readonly story = new StoryStateService(files, projects)
  ) {}

  async findReferences(projectPath: string, target: StoryEntityRef): Promise<StoryReferenceHit[]> {
    return findStoryReferences(await this.loadData(projectPath), target);
  }

  async deleteEntity(
    projectPath: string,
    target: StoryEntityRef,
    mode: "force" | StoryDetachMode,
    replacement = ""
  ): Promise<void> {
    if (mode === "replace" && !replacement.trim()) {
      throw new Error("替换实体时必须提供新的名称。");
    }
    if (mode !== "force") {
      await this.applyDetach(projectPath, target, mode, replacement.trim());
    }
    switch (target.kind) {
      case "character":
        await this.library.deleteCharacter(projectPath, target.id);
        return;
      case "world":
        await this.library.deleteWorldEntry(projectPath, target.id);
        return;
      case "timeline":
        await this.story.deleteTimelineEvent(projectPath, target.id);
        return;
      case "clue":
        await this.story.deleteClue(projectPath, target.id);
        return;
      case "term":
        await this.story.deleteTerm(projectPath, target.id);
        return;
      case "conflict":
        await this.story.deleteConflict(projectPath, target.id);
        return;
      default:
        throw new Error(`Unknown entity kind: ${String(target.kind)}`);
    }
  }

  private async applyDetach(
    projectPath: string,
    target: StoryEntityRef,
    mode: StoryDetachMode,
    replacement: string
  ): Promise<void> {
    const data = await this.loadData(projectPath);
    const result = detachStoryReferences(data, target, mode, replacement);
    for (const id of result.changedCharacterIds) {
      const character = result.characters.find((item) => item.id === id);
      if (character) {
        await this.library.saveCharacter(projectPath, character);
      }
    }
    for (const id of result.changedWorldIds) {
      const entry = result.worldEntries.find((item) => item.id === id);
      if (entry) {
        await this.library.saveWorldEntry(projectPath, entry);
      }
    }
    for (const id of result.changedTimelineIds) {
      const event = result.timeline.find((item) => item.id === id);
      if (event) {
        await this.story.saveTimelineEvent(projectPath, event);
      }
    }
    for (const id of result.changedClueIds) {
      const clue = result.clues.find((item) => item.id === id);
      if (clue) {
        await this.story.saveClue(projectPath, clue);
      }
    }
    for (const id of result.changedConflictIds) {
      const conflict = result.conflicts.find((item) => item.id === id);
      if (conflict) {
        await this.story.saveConflict(projectPath, conflict);
      }
    }
    if (result.chaptersChanged) {
      const project = await this.projects.openProject(projectPath);
      const chapterById = new Map(result.chapters.map((chapter) => [chapter.id, chapter]));
      await this.projects.updateOutline({
        projectPath,
        outline: {
          ...project.outline,
          volumes: project.outline.volumes.map((volume) => ({
            ...volume,
            chapters: volume.chapters.map((chapter) => chapterById.get(chapter.id) ?? chapter)
          }))
        }
      });
    }
  }

  private async loadData(projectPath: string): Promise<StoryReferenceData> {
    const [project, characters, worldEntries, timeline, clues, terms, conflicts] = await Promise.all([
      this.projects.openProject(projectPath),
      this.library.listCharacters(projectPath),
      this.library.listWorldEntries(projectPath),
      this.story.listTimeline(projectPath),
      this.story.listClues(projectPath),
      this.story.listTerms(projectPath),
      this.story.listConflicts(projectPath)
    ]);
    return {
      characters,
      worldEntries,
      timeline,
      clues,
      terms,
      conflicts,
      chapters: project.outline.volumes.flatMap((volume) => volume.chapters)
    };
  }
}
