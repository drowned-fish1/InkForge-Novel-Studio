import {
  detachStoryReferences,
  findStoryReferences,
  migrateStoryReferencesToIds,
  type Character,
  type StoryDetachMode,
  type StoryEntityRef,
  type StoryReferenceData,
  type StoryReferenceHit,
  type WorldEntry
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

  /**
   * Persist additive stable-ID mirrors for unambiguous legacy references.
   * Legacy display-name fields are deliberately retained for rollback with an
   * older InkForge build. The operation is idempotent.
   */
  async migrateLegacyReferences(projectPath: string): Promise<number> {
    const result = migrateStoryReferencesToIds(await this.loadData(projectPath));
    if (!result.migratedReferenceCount) return 0;
    await this.persistChanges(projectPath, result);
    return result.migratedReferenceCount;
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

  /**
   * Save a character and, if its primary name changed, rewrite every
   * reference to the old name across the project (relations, participants,
   * conflict parties, chapter refs). Returns the refreshed character list.
   */
  async saveCharacterWithRenameSync(projectPath: string, character: Character): Promise<Character[]> {
    const existing = (await this.library.listCharacters(projectPath)).find((item) => item.id === character.id);
    const oldName = existing?.name.trim() ?? "";
    const newName = character.name.trim();
    await this.library.saveCharacter(projectPath, character);
    if (existing && oldName && newName && oldName !== newName) {
      await this.applyDetach(
        projectPath,
        { kind: "character", id: character.id },
        "replace",
        newName,
        new Set([oldName])
      );
    }
    return this.library.listCharacters(projectPath);
  }

  /** World-entry variant of saveCharacterWithRenameSync (title rename). */
  async saveWorldEntryWithRenameSync(projectPath: string, entry: WorldEntry): Promise<WorldEntry[]> {
    const existing = (await this.library.listWorldEntries(projectPath)).find((item) => item.id === entry.id);
    const oldTitle = existing?.title.trim() ?? "";
    const newTitle = entry.title.trim();
    await this.library.saveWorldEntry(projectPath, entry);
    if (existing && oldTitle && newTitle && oldTitle !== newTitle) {
      await this.applyDetach(projectPath, { kind: "world", id: entry.id }, "replace", newTitle, new Set([oldTitle]));
    }
    return this.library.listWorldEntries(projectPath);
  }

  private async applyDetach(
    projectPath: string,
    target: StoryEntityRef,
    mode: StoryDetachMode,
    replacement: string,
    namesOverride?: Set<string>
  ): Promise<void> {
    const data = await this.loadData(projectPath);
    const result = detachStoryReferences(data, target, mode, replacement, namesOverride);
    await this.persistChanges(projectPath, result);
  }

  private async persistChanges(
    projectPath: string,
    result: ReturnType<typeof detachStoryReferences> | ReturnType<typeof migrateStoryReferencesToIds>
  ): Promise<void> {
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
