import {
  ChunkIndexService,
  type EmbeddingProvider,
  type EvidenceRef,
  type IndexedChunk,
  localHashEmbeddingProvider
} from "./ChunkIndexService.js";
import { semanticVectorSimilarity, tokenizeSemanticText } from "./SemanticIndexService.js";

export type RetrievalMode = "lexical" | "semantic" | "hybrid";

export interface HybridRetrieveOptions {
  limit?: number;
  mode?: RetrievalMode;
  /** Alias for mode, useful for callers that expose a search strategy field. */
  strategy?: RetrievalMode;
  chapterIds?: readonly string[];
  sceneIds?: readonly string[];
  minScore?: number;
  lexicalWeight?: number;
  semanticWeight?: number;
  embeddingProvider?: EmbeddingProvider;
}

export interface HybridSearchHit {
  /** Stable derived chunk id. */
  id: string;
  chunkId: string;
  chapterId: string;
  chapterTitle: string;
  sceneId?: string;
  score: number;
  lexicalScore: number;
  semanticScore: number;
  /** Actual strategy used for this hit. */
  mode: RetrievalMode;
  retrievalMode: RetrievalMode;
  snippet: string;
  /** EvidenceRef-style source for editor navigation. */
  source: EvidenceRef;
  evidence: EvidenceRef;
  /** Full chunk bounds, in addition to the excerpt bounds in source. */
  chunkStartOffset: number;
  chunkEndOffset: number;
  contentHash: string;
}

export interface HybridSearchResult {
  hits: HybridSearchHit[];
  /** Requested mode and the mode actually used when embeddings are available. */
  mode: RetrievalMode;
  retrievalMode: RetrievalMode;
  semanticAvailable: boolean;
  embeddingProviderId?: string;
  indexedChunks: number;
  query: string;
}

export interface HybridRetrieverOptions {
  embeddingProvider?: EmbeddingProvider;
  lexicalWeight?: number;
  semanticWeight?: number;
  minScore?: number;
}

/**
 * Search derived chunks without reading chapter source files. Lexical search
 * provides exact names/phrases; semantic search uses the persisted local hash
 * vectors or a caller-provided embedding provider.
 */
export class HybridRetriever {
  private readonly options: HybridRetrieverOptions;

  constructor(
    private readonly index: ChunkIndexService,
    options: HybridRetrieverOptions = {}
  ) {
    this.options = options;
  }

  async retrieve(projectPath: string, query: string, options: HybridRetrieveOptions = {}): Promise<HybridSearchResult> {
    const normalizedQuery = query.trim();
    const requestedMode = options.mode ?? options.strategy ?? "hybrid";
    if (!normalizedQuery) {
      return {
        hits: [],
        mode: requestedMode,
        retrievalMode: requestedMode,
        semanticAvailable: false,
        indexedChunks: 0,
        query: normalizedQuery
      };
    }

    const chunks = await this.index.getChunks(projectPath, options.chapterIds);
    const sceneFilter = options.sceneIds ? new Set(options.sceneIds) : undefined;
    const filteredChunks = sceneFilter
      ? chunks.filter((chunk) => chunk.sceneId && sceneFilter.has(chunk.sceneId))
      : chunks;
    const provider = options.embeddingProvider ?? this.options.embeddingProvider ?? this.index.embeddingProvider;
    const semanticAvailable = isCompatibleProvider(provider, await this.index.getManifest(projectPath));
    const actualMode: RetrievalMode =
      requestedMode === "semantic" && !semanticAvailable
        ? "lexical"
        : requestedMode === "hybrid" && !semanticAvailable
          ? "lexical"
          : requestedMode;
    const queryVector =
      semanticAvailable && actualMode !== "lexical" ? await embedQuery(provider, normalizedQuery) : undefined;
    const lexicalTerms = new Set(tokenizeSemanticText(normalizedQuery));
    const lexicalWeight = clampWeight(options.lexicalWeight ?? this.options.lexicalWeight ?? 0.62);
    const semanticWeight = clampWeight(options.semanticWeight ?? this.options.semanticWeight ?? 0.38);
    const normalizedWeights = normalizeWeights(lexicalWeight, semanticWeight);
    const minScore = Math.max(0, options.minScore ?? this.options.minScore ?? 0.025);
    const hits = filteredChunks
      .map((chunk) => {
        const lexicalScore = scoreLexical(normalizedQuery, lexicalTerms, chunk);
        const semanticScore = queryVector ? semanticVectorSimilarity(queryVector, chunk.vector) : 0;
        const score = scoreForMode(actualMode, lexicalScore, semanticScore, normalizedWeights);
        return { chunk, lexicalScore, semanticScore, score };
      })
      .filter((item) => item.score >= minScore)
      .sort(
        (left, right) =>
          right.score - left.score ||
          right.lexicalScore - left.lexicalScore ||
          left.chunk.chapterId.localeCompare(right.chunk.chapterId) ||
          left.chunk.startOffset - right.chunk.startOffset
      )
      .slice(0, clampLimit(options.limit ?? 20))
      .map(({ chunk, lexicalScore, semanticScore, score }) =>
        toHit(chunk, normalizedQuery, actualMode, score, lexicalScore, semanticScore)
      );

    return {
      hits,
      mode: actualMode,
      retrievalMode: actualMode,
      semanticAvailable,
      embeddingProviderId: semanticAvailable ? provider.id : undefined,
      indexedChunks: chunks.length,
      query: normalizedQuery
    };
  }

  async search(projectPath: string, query: string, options: HybridRetrieveOptions = {}): Promise<HybridSearchResult> {
    return this.retrieve(projectPath, query, options);
  }

  /** A convenience API for integrations that only need the ordered hits. */
  async retrieveHits(
    projectPath: string,
    query: string,
    options: HybridRetrieveOptions = {}
  ): Promise<HybridSearchHit[]> {
    return (await this.retrieve(projectPath, query, options)).hits;
  }
}

const scoreLexical = (query: string, queryTerms: Set<string>, chunk: IndexedChunk): number => {
  const text = `${chunk.chapterTitle}\n${chunk.text}`;
  const lowerText = text.normalize("NFKC").toLocaleLowerCase();
  const lowerQuery = query.normalize("NFKC").toLocaleLowerCase();
  const exactIndex = lowerText.indexOf(lowerQuery);
  const documentTerms = new Set(tokenizeSemanticText(text));
  const overlap = queryTerms.size
    ? [...queryTerms].filter((term) => documentTerms.has(term)).length / queryTerms.size
    : 0;
  const phraseScore = exactIndex >= 0 ? 1 : 0;
  // Exact phrase recall is intentionally dominant for names, terms and
  // quoted clues, while token overlap still handles natural-language queries.
  const titleExact = chunk.chapterTitle.normalize("NFKC").toLocaleLowerCase().includes(lowerQuery);
  const score = overlap * 0.63 + phraseScore * 0.3 + (titleExact ? 0.07 : 0);
  return Math.min(1, score);
};

const scoreForMode = (
  mode: RetrievalMode,
  lexicalScore: number,
  semanticScore: number,
  weights: { lexical: number; semantic: number }
): number => {
  if (mode === "lexical") {
    return lexicalScore;
  }
  if (mode === "semantic") {
    return semanticScore;
  }
  return lexicalScore * weights.lexical + semanticScore * weights.semantic;
};

const toHit = (
  chunk: IndexedChunk,
  query: string,
  mode: RetrievalMode,
  score: number,
  lexicalScore: number,
  semanticScore: number
): HybridSearchHit => {
  const excerpt = bestExcerpt(chunk.text, query);
  const excerptStart = excerpt.offset;
  const source: EvidenceRef = {
    chapterId: chunk.chapterId,
    sceneId: chunk.sceneId,
    startOffset: chunk.startOffset + excerptStart,
    endOffset: chunk.startOffset + excerptStart + excerpt.text.length,
    excerpt: excerpt.text,
    contentHash: chunk.contentHash
  };
  return {
    id: chunk.id,
    chunkId: chunk.id,
    chapterId: chunk.chapterId,
    chapterTitle: chunk.chapterTitle,
    sceneId: chunk.sceneId,
    score,
    lexicalScore,
    semanticScore,
    mode,
    retrievalMode: mode,
    snippet: excerpt.text,
    source,
    evidence: source,
    chunkStartOffset: chunk.startOffset,
    chunkEndOffset: chunk.endOffset,
    contentHash: chunk.contentHash
  };
};

const bestExcerpt = (text: string, query: string): { text: string; offset: number } => {
  const maxLength = 360;
  // Do not normalize here: NFKC can change string length and invalidate the
  // offset into the original manuscript. Lexical scoring may normalize, but
  // navigation excerpts must be calculated against the original text.
  const normalizedText = text.toLocaleLowerCase();
  const normalizedQuery = query.toLocaleLowerCase();
  const queryOffset = normalizedText.indexOf(normalizedQuery);
  const center = queryOffset >= 0 ? queryOffset : 0;
  let start = Math.max(0, Math.min(center - 120, text.length - maxLength));
  let end = Math.min(text.length, start + maxLength);
  // Trim only at the edges so source offsets still address the exact
  // substring returned as the excerpt (collapsing whitespace would make the
  // end offset inaccurate for editor navigation).
  while (start < end && /\s/u.test(text[start] ?? "")) {
    start += 1;
  }
  while (end > start && /\s/u.test(text[end - 1] ?? "")) {
    end -= 1;
  }
  return {
    text: text.slice(start, end),
    offset: start
  };
};

const embedQuery = async (provider: EmbeddingProvider, query: string): Promise<number[]> => {
  const vector = await provider.embed(query);
  const values = [...vector].map((value) => (Number.isFinite(value) ? value : 0));
  const magnitude = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  return magnitude ? values.map((value) => value / magnitude) : values;
};

const isCompatibleProvider = (
  provider: EmbeddingProvider,
  manifest: { embeddingProviderId: string; embeddingDimensions: number }
): boolean => {
  // A custom provider can be used only when the indexed vectors were produced
  // by the same provider/model. This prevents silently mixing incompatible
  // vector spaces after a model upgrade.
  return (
    provider.id === manifest.embeddingProviderId &&
    (provider.dimensions === undefined || provider.dimensions === manifest.embeddingDimensions)
  );
};

const clampLimit = (value: number): number => Math.max(1, Math.min(100, Math.trunc(value)));
const clampWeight = (value: number): number => (Number.isFinite(value) && value >= 0 ? value : 0);
const normalizeWeights = (lexical: number, semantic: number): { lexical: number; semantic: number } => {
  const sum = lexical + semantic;
  return sum > 0 ? { lexical: lexical / sum, semantic: semantic / sum } : { lexical: 0.62, semantic: 0.38 };
};

export { localHashEmbeddingProvider };
