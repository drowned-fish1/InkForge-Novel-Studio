import { createHash } from "node:crypto";
import path from "node:path";
import type { AgentSourceReference } from "@inkforge/schemas";
import { ChapterMemoryService } from "./ChapterMemoryService.js";
import { FileRepository } from "./FileRepository.js";
import { LibraryService } from "./LibraryService.js";
import { ProjectService } from "./ProjectService.js";
import { StoryStateService } from "./StoryStateService.js";

const vectorDimensions = 384;
const maxDocumentCharacters = 20_000;

interface SemanticDocument {
  id: string;
  kind: AgentSourceReference["kind"];
  title: string;
  text: string;
  vector: number[];
}

interface PersistedSemanticIndex {
  version: 1;
  fingerprint: string;
  generatedAt: string;
  documents: SemanticDocument[];
}

export interface SemanticSearchHit extends AgentSourceReference {
  score: number;
}

export interface SemanticSearchResult {
  hits: SemanticSearchHit[];
  indexedDocuments: number;
  rebuilt: boolean;
}

export class SemanticIndexService {
  constructor(
    private readonly files = new FileRepository(),
    private readonly projects = new ProjectService(files),
    private readonly library = new LibraryService(files),
    private readonly story = new StoryStateService(files, projects),
    private readonly memories = new ChapterMemoryService(files)
  ) {}

  async search(projectPath: string, query: string, limit = 8): Promise<SemanticSearchResult> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      return { hits: [], indexedDocuments: 0, rebuilt: false };
    }
    const rawDocuments = await this.collectDocuments(projectPath);
    const fingerprint = fingerprintDocuments(rawDocuments);
    const existing = await this.load(projectPath);
    const rebuilt = !existing || existing.fingerprint !== fingerprint;
    const index: PersistedSemanticIndex = rebuilt
      ? {
          version: 1,
          fingerprint,
          generatedAt: new Date().toISOString(),
          documents: rawDocuments.map((document) => ({
            ...document,
            vector: createLocalSemanticVector(`${document.title} ${document.title} ${document.text}`)
          }))
        }
      : existing;
    if (rebuilt) {
      await this.files.writeJsonAtomic(this.indexPath(projectPath), index);
    }

    const queryVector = createLocalSemanticVector(normalizedQuery);
    const queryTerms = new Set(tokenizeSemanticText(normalizedQuery));
    const hits = index.documents
      .map((document) => {
        const vectorScore = semanticVectorSimilarity(queryVector, document.vector);
        const documentTerms = new Set(tokenizeSemanticText(`${document.title} ${document.text.slice(0, 4_000)}`));
        const overlap = [...queryTerms].filter((term) => documentTerms.has(term)).length;
        const lexicalScore = queryTerms.size ? overlap / queryTerms.size : 0;
        const exactBoost = `${document.title} ${document.text}`
          .toLocaleLowerCase()
          .includes(normalizedQuery.toLocaleLowerCase())
          ? 0.18
          : 0;
        return {
          kind: document.kind,
          id: document.id,
          title: document.title,
          snippet: bestSnippet(document.text, normalizedQuery),
          score: Math.min(1, vectorScore * 0.72 + lexicalScore * 0.28 + exactBoost)
        } satisfies SemanticSearchHit;
      })
      .filter((hit) => hit.score >= 0.045)
      .sort((left, right) => right.score - left.score)
      .slice(0, Math.max(1, Math.min(20, limit)));

    return { hits, indexedDocuments: index.documents.length, rebuilt };
  }

  private async collectDocuments(projectPath: string): Promise<Array<Omit<SemanticDocument, "vector">>> {
    const project = await this.projects.openProject(projectPath);
    const chapters = project.outline.volumes.flatMap((volume) => volume.chapters);
    const [characters, world, clues, terms, timeline, chapterContents, memories] = await Promise.all([
      this.library.listCharacters(projectPath),
      this.library.listWorldEntries(projectPath),
      this.story.listClues(projectPath),
      this.story.listTerms(projectPath),
      this.story.listTimeline(projectPath),
      Promise.all(
        chapters.map((chapter) =>
          this.files.readText(this.files.assertInsideProject(projectPath, chapter.file)).catch(() => "")
        )
      ),
      Promise.all(chapters.map((chapter) => this.memories.load(projectPath, chapter.id)))
    ]);

    return [
      {
        id: project.meta.projectId,
        kind: "outline" as const,
        title: `${project.meta.title} · 总纲`,
        text: limitDocument(
          [project.outline.premise, project.outline.mainConflict, project.outline.endingDirection].join("\n")
        )
      },
      ...project.outline.volumes.map((volume) => ({
        id: volume.id,
        kind: "outline" as const,
        title: `${volume.title} · 卷纲`,
        text: limitDocument(
          [
            volume.goal,
            ...volume.chapters.map(
              (chapter) =>
                `${chapter.number}. ${chapter.title}\n目标：${chapter.goal}\n钩子：${chapter.hook}\n冲突：${chapter.conflictPoints}`
            )
          ].join("\n")
        )
      })),
      ...chapters.map((chapter, index) => ({
        id: chapter.id,
        kind: "chapter" as const,
        title: chapter.title,
        text: limitDocument(
          [chapter.goal, chapter.hook, chapter.conflictPoints, chapter.notes, chapterContents[index]].join("\n")
        )
      })),
      ...characters.map((item) => ({
        id: item.id,
        kind: "character" as const,
        title: item.name,
        text: limitDocument(JSON.stringify(item))
      })),
      ...world.map((item) => ({
        id: item.id,
        kind: "world" as const,
        title: item.title,
        text: limitDocument([item.summary, item.content, item.tags.join(" ")].join("\n"))
      })),
      ...clues.map((item) => ({
        id: item.id,
        kind: "clue" as const,
        title: item.title,
        text: limitDocument(JSON.stringify(item))
      })),
      ...terms.map((item) => ({
        id: item.id,
        kind: "term" as const,
        title: item.name,
        text: limitDocument(JSON.stringify(item))
      })),
      ...timeline.map((item) => ({
        id: item.id,
        kind: "timeline" as const,
        title: item.title,
        text: limitDocument(JSON.stringify(item))
      })),
      ...chapters.flatMap((chapter, index) =>
        memories[index]
          ? [
              {
                id: chapter.id,
                kind: "memory" as const,
                title: `${chapter.title} · 章节记忆`,
                text: limitDocument(JSON.stringify(memories[index]))
              }
            ]
          : []
      )
    ].filter((document) => document.text.trim());
  }

  private async load(projectPath: string): Promise<PersistedSemanticIndex | undefined> {
    try {
      const value = await this.files.readJson<PersistedSemanticIndex>(this.indexPath(projectPath));
      if (value.version !== 1 || !Array.isArray(value.documents)) {
        return undefined;
      }
      return value;
    } catch (error) {
      if (isMissingFile(error)) {
        return undefined;
      }
      throw error;
    }
  }

  private indexPath(projectPath: string): string {
    return this.files.assertInsideProject(
      projectPath,
      path.posix.join(".inkforge", "agents", "index", "semantic-index.json")
    );
  }
}

export const tokenizeSemanticText = (value: string): string[] => {
  const normalized = value.normalize("NFKC").toLocaleLowerCase();
  const tokens = normalized.match(/[\p{Script=Han}]+|[a-z0-9_]+/gu) ?? [];
  const result: string[] = [];
  for (const token of tokens) {
    if (/^[\p{Script=Han}]+$/u.test(token)) {
      const characters = [...token];
      result.push(...characters);
      for (let index = 0; index < characters.length - 1; index += 1) {
        result.push(`${characters[index]}${characters[index + 1]}`);
      }
    } else if (token.length > 1) {
      result.push(token);
    }
  }
  return result;
};

export const createLocalSemanticVector = (value: string): number[] => {
  const vector = Array.from({ length: vectorDimensions }, () => 0);
  for (const token of tokenizeSemanticText(value)) {
    const hash = hashToken(token);
    const index = Math.abs(hash) % vectorDimensions;
    vector[index] += hash < 0 ? -1 : 1;
  }
  const magnitude = Math.sqrt(vector.reduce((total, item) => total + item * item, 0));
  return magnitude ? vector.map((item) => item / magnitude) : vector;
};

export const semanticVectorSimilarity = (left: number[], right: number[]): number => {
  const length = Math.min(left.length, right.length);
  let score = 0;
  for (let index = 0; index < length; index += 1) {
    score += left[index] * right[index];
  }
  return Math.max(0, score);
};

const hashToken = (value: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash | 0;
};

const fingerprintDocuments = (documents: Array<Omit<SemanticDocument, "vector">>): string =>
  createHash("sha256")
    .update(JSON.stringify(documents.map(({ id, kind, title, text }) => [id, kind, title, text])))
    .digest("hex");

const limitDocument = (value: string): string => value.trim().slice(0, maxDocumentCharacters);

const bestSnippet = (text: string, query: string): string => {
  const normalized = text.toLocaleLowerCase();
  const index = normalized.indexOf(query.toLocaleLowerCase());
  const start = index >= 0 ? Math.max(0, index - 100) : 0;
  return text
    .slice(start, start + 320)
    .replace(/\s+/g, " ")
    .trim();
};

const isMissingFile = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT";
