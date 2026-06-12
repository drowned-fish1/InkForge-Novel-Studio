export type ChapterContextSectionKey =
  | "outline"
  | "summaries"
  | "characters"
  | "clues"
  | "terms"
  | "timeline"
  | "world";

export interface ContextChapterPlan {
  id: string;
  number: number;
  title: string;
  file?: string;
  goal?: string;
  hook?: string;
  conflictPoints?: string;
}

export interface ContextOutline {
  premise?: string;
  mainConflict?: string;
  endingDirection?: string;
  volumes?: Array<{
    id: string;
    title: string;
    chapters: ContextChapterPlan[];
  }>;
}

export interface ContextChapterSummary {
  chapterId: string;
  chapterTitle: string;
  summaryText?: string;
  contextSummary?: string;
}

export interface ContextCharacter {
  id: string;
  name: string;
  role?: string;
  profile?: {
    identity?: string;
    motivation?: string;
  };
  currentState?: {
    arc?: string;
    powerLevel?: string;
    location?: string;
  };
  voiceNotes?: string;
}

export interface ContextClue {
  id: string;
  title: string;
  plantedChapterId?: string;
  expectedPayoff?: string;
  status?: string;
  notes?: string;
}

export interface ContextTerm {
  id: string;
  name: string;
  category?: string;
  definition?: string;
  locked?: boolean;
}

export interface ContextTimelineEvent {
  id: string;
  chapterId?: string;
  order: number;
  title: string;
  location?: string;
  summary?: string;
}

export interface ContextWorldEntry {
  id: string;
  title: string;
  type?: string;
  locked?: boolean;
  summary?: string;
  content?: string;
}

export interface ChapterContextBuilderOptions {
  tokenBudget?: number;
  currentChapterId?: string;
  currentChapterNumber?: number;
  maxItemsPerSection?: Partial<Record<ChapterContextSectionKey, number>>;
}

export interface ChapterContextInput {
  outline?: ContextOutline;
  summaries?: ContextChapterSummary[];
  characters?: ContextCharacter[];
  clues?: ContextClue[];
  terms?: ContextTerm[];
  timeline?: ContextTimelineEvent[];
  world?: ContextWorldEntry[];
}

export interface ChapterContextSection {
  key: ChapterContextSectionKey;
  title: string;
  priority: number;
  content: string;
  estimatedTokens: number;
  included: boolean;
  truncated: boolean;
}

export interface ChapterContext {
  summary: string;
  sections: ChapterContextSection[];
  totalTokens: number;
  tokenBudget: number;
  omittedSections: ChapterContextSectionKey[];
}

interface SectionDraft {
  key: ChapterContextSectionKey;
  title: string;
  priority: number;
  lines: string[];
}

const defaultBudget = 1800;
const charsPerToken = 3;

const sectionPriority: Record<ChapterContextSectionKey, number> = {
  outline: 100,
  summaries: 90,
  characters: 80,
  clues: 70,
  terms: 60,
  timeline: 50,
  world: 40
};

const defaultMaxItems: Record<ChapterContextSectionKey, number> = {
  outline: 8,
  summaries: 6,
  characters: 10,
  clues: 10,
  terms: 12,
  timeline: 10,
  world: 8
};

export const estimateContextTokens = (text: string): number => Math.ceil(text.length / charsPerToken);

const nonEmpty = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const joinFields = (fields: Array<string | undefined>): string => fields.filter(Boolean).join("; ");

const currentChapter = (
  outline: ContextOutline | undefined,
  chapterId: string | undefined,
  chapterNumber: number | undefined
) => {
  for (const volume of outline?.volumes ?? []) {
    const found = volume.chapters.find((chapter) => chapter.id === chapterId || chapter.number === chapterNumber);
    if (found) return found;
  }
  return undefined;
};

const renderDraft = (draft: SectionDraft, maxItems: number): SectionDraft | undefined => {
  const lines = draft.lines.filter((line) => line.trim()).slice(0, maxItems);
  if (lines.length === 0) return undefined;
  return { ...draft, lines };
};

const createSection = (draft: SectionDraft, allowedTokens: number): ChapterContextSection => {
  const header = `## ${draft.title}`;
  const fullContent = [header, ...draft.lines].join("\n");
  const fullTokens = estimateContextTokens(fullContent);
  if (fullTokens <= allowedTokens) {
    return {
      key: draft.key,
      title: draft.title,
      priority: draft.priority,
      content: fullContent,
      estimatedTokens: fullTokens,
      included: true,
      truncated: false
    };
  }

  const kept: string[] = [];
  for (const line of draft.lines) {
    const candidate = [header, ...kept, line].join("\n");
    if (estimateContextTokens(candidate) > allowedTokens) break;
    kept.push(line);
  }

  const content = kept.length > 0 ? [header, ...kept, "- ..."].join("\n") : `${header}\n- ...`;
  return {
    key: draft.key,
    title: draft.title,
    priority: draft.priority,
    content,
    estimatedTokens: estimateContextTokens(content),
    included: kept.length > 0,
    truncated: true
  };
};

export class ChapterContextBuilder {
  build(input: ChapterContextInput, options: ChapterContextBuilderOptions = {}): ChapterContext {
    const tokenBudget = Math.max(120, options.tokenBudget ?? defaultBudget);
    const maxItems = { ...defaultMaxItems, ...options.maxItemsPerSection };
    const drafts = this.createDrafts(input, options)
      .map((draft) => renderDraft(draft, maxItems[draft.key]))
      .filter((draft): draft is SectionDraft => Boolean(draft))
      .sort((a, b) => b.priority - a.priority);

    let remaining = tokenBudget;
    const sections: ChapterContextSection[] = [];
    for (const draft of drafts) {
      if (remaining <= 0) {
        sections.push({
          key: draft.key,
          title: draft.title,
          priority: draft.priority,
          content: "",
          estimatedTokens: 0,
          included: false,
          truncated: true
        });
        continue;
      }

      const section = createSection(draft, remaining);
      sections.push(section);
      remaining -= section.estimatedTokens;
    }

    const included = sections.filter((section) => section.included);
    return {
      summary: included.map((section) => section.content).join("\n\n"),
      sections,
      totalTokens: included.reduce((total, section) => total + section.estimatedTokens, 0),
      tokenBudget,
      omittedSections: sections.filter((section) => !section.included).map((section) => section.key)
    };
  }

  private createDrafts(input: ChapterContextInput, options: ChapterContextBuilderOptions): SectionDraft[] {
    const chapter = currentChapter(input.outline, options.currentChapterId, options.currentChapterNumber);
    const drafts: SectionDraft[] = [];

    if (input.outline) {
      drafts.push({
        key: "outline",
        title: "Project Outline",
        priority: sectionPriority.outline,
        lines: [
          nonEmpty(input.outline.premise) ? `- Premise: ${input.outline.premise}` : "",
          nonEmpty(input.outline.mainConflict) ? `- Main conflict: ${input.outline.mainConflict}` : "",
          nonEmpty(input.outline.endingDirection) ? `- Ending: ${input.outline.endingDirection}` : "",
          chapter
            ? `- Current chapter: #${chapter.number} ${chapter.title}. ${joinFields([
                nonEmpty(chapter.goal) && `Goal: ${chapter.goal}`,
                nonEmpty(chapter.hook) && `Hook: ${chapter.hook}`,
                nonEmpty(chapter.conflictPoints) && `Conflict: ${chapter.conflictPoints}`
              ])}`
            : "",
          ...(input.outline.volumes ?? []).flatMap((volume) =>
            volume.chapters.map(
              (item) =>
                `- Chapter #${item.number} ${item.title}: ${joinFields([nonEmpty(item.goal), nonEmpty(item.hook)])}`
            )
          )
        ]
      });
    }

    drafts.push({
      key: "summaries",
      title: "Chapter Summaries",
      priority: sectionPriority.summaries,
      lines: (input.summaries ?? []).map(
        (summary) =>
          `- ${summary.chapterTitle}: ${joinFields([nonEmpty(summary.summaryText), nonEmpty(summary.contextSummary)]) || "No summary text"}`
      )
    });

    drafts.push({
      key: "characters",
      title: "Characters",
      priority: sectionPriority.characters,
      lines: (input.characters ?? []).map(
        (character) =>
          `- ${character.name}: ${joinFields([
            nonEmpty(character.role),
            nonEmpty(character.profile?.identity),
            nonEmpty(character.profile?.motivation),
            nonEmpty(character.currentState?.arc),
            nonEmpty(character.currentState?.powerLevel) && `Power: ${character.currentState?.powerLevel}`,
            nonEmpty(character.currentState?.location) && `Location: ${character.currentState?.location}`,
            nonEmpty(character.voiceNotes) && `Voice: ${character.voiceNotes}`
          ])}`
      )
    });

    drafts.push({
      key: "clues",
      title: "Foreshadowing And Clues",
      priority: sectionPriority.clues,
      lines: (input.clues ?? []).map(
        (clue) =>
          `- ${clue.title} [${clue.status ?? "planned"}]: ${joinFields([
            clue.plantedChapterId && `Planted: ${clue.plantedChapterId}`,
            nonEmpty(clue.expectedPayoff) && `Payoff: ${clue.expectedPayoff}`,
            nonEmpty(clue.notes)
          ])}`
      )
    });

    drafts.push({
      key: "terms",
      title: "Terms",
      priority: sectionPriority.terms,
      lines: (input.terms ?? []).map(
        (term) =>
          `- ${term.name}${term.locked ? " [locked]" : ""}: ${joinFields([nonEmpty(term.category), nonEmpty(term.definition)])}`
      )
    });

    drafts.push({
      key: "timeline",
      title: "Timeline",
      priority: sectionPriority.timeline,
      lines: [...(input.timeline ?? [])]
        .sort((a, b) => a.order - b.order)
        .map(
          (event) =>
            `- ${event.order}. ${event.title}: ${joinFields([event.chapterId, nonEmpty(event.location), nonEmpty(event.summary)])}`
        )
    });

    drafts.push({
      key: "world",
      title: "World",
      priority: sectionPriority.world,
      lines: (input.world ?? []).map(
        (entry) =>
          `- ${entry.title}${entry.locked ? " [locked]" : ""}: ${joinFields([entry.type, nonEmpty(entry.summary), nonEmpty(entry.content)])}`
      )
    });

    return drafts;
  }
}
