import type { ProjectSearchResult } from "../types.js";
import { searchChapterContent, searchStoryEntries } from "./ProjectSearchEntries.js";
import { FileRepository } from "./FileRepository.js";
import { LibraryService } from "./LibraryService.js";
import { ProjectService } from "./ProjectService.js";
import { StoryStateService } from "./StoryStateService.js";

const maxResults = 60;

/** Full-text search across chapter contents plus entity names/summaries. */
export class ProjectSearchService {
  constructor(
    private readonly files = new FileRepository(),
    private readonly projects = new ProjectService(files),
    private readonly library = new LibraryService(files),
    private readonly story = new StoryStateService(files, projects)
  ) {}

  async search(projectPath: string, rawQuery: string): Promise<ProjectSearchResult[]> {
    const query = rawQuery.trim();
    if (query.length < 1) {
      return [];
    }
    const results: ProjectSearchResult[] = [];
    const project = await this.projects.openProject(projectPath);

    for (const volume of project.outline.volumes) {
      for (const chapter of volume.chapters) {
        if (chapter.archived || results.length >= maxResults) {
          continue;
        }
        const content = await this.files
          .readText(this.files.assertInsideProject(projectPath, chapter.file))
          .catch(() => "");
        results.push(
          ...searchChapterContent(chapter, volume.title, content, query).slice(0, maxResults - results.length)
        );
      }
    }

    const [characters, world, conflicts, clues, terms, timeline] = await Promise.all([
      this.library.listCharacters(projectPath),
      this.library.listWorldEntries(projectPath),
      this.story.listConflicts(projectPath),
      this.story.listClues(projectPath),
      this.story.listTerms(projectPath),
      this.story.listTimeline(projectPath)
    ]);
    results.push(
      ...searchStoryEntries(
        { characters, world, conflicts, clues, terms, timeline },
        query,
        maxResults - results.length
      )
    );

    return results;
  }
}
