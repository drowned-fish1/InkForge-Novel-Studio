import {
  CharacterSchema,
  ClueSchema,
  ConflictSchema,
  detachStoryReferences,
  findStoryReferences,
  renameStoryReferences,
  inkforgeSchemaVersion,
  OutlineSchema,
  PlanningPackageSchema,
  TermSchema,
  TimelineEventSchema,
  WorldEntrySchema,
  type Character,
  type Clue,
  type Conflict,
  type StoryEntityRef,
  type StoryReferenceData,
  type StoryReferenceHit,
  type Term,
  type TimelineEvent,
  type WorldEntry
} from "@inkforge/schemas";
import type {
  ConsistencyIssue,
  PlanningAiInput,
  PlanningImportResult,
  PlanningImportSelection,
  PlanningPackage,
  PlanningSession,
  ProjectSummary,
  SaveCharacterInput,
  SaveClueInput,
  SaveTermInput,
  SaveTimelineEventInput,
  SaveWorldEntryInput
} from "@/types/app";
import {
  createDefaultPlanningPrompt,
  promptPlanningTemplateFileName,
  renderPrompt,
  type PlanningMode
} from "@inkforge/prompt-engine";
import type { PromptTemplate } from "@inkforge/schemas";
import { hasAuthMaterial } from "@/lib/browserAiProvider";
import { getProjectRecord, readProviderStorage, saveProjectRecord } from "@/lib/browserStorage";

const chapterFile = (volumeNumber: number, chapterNumber: number): string =>
  `chapters/volume-${String(volumeNumber).padStart(3, "0")}/ch-${String(chapterNumber).padStart(4, "0")}.md`;

export const browserLibraryService = {
  async listCharacters(projectPath: string): Promise<Character[]> {
    return structuredClone(getProjectRecord(projectPath).characters.map(normalizeCharacter));
  },
  async saveCharacter(input: SaveCharacterInput): Promise<Character[]> {
    const record = getProjectRecord(input.projectPath);
    const character = normalizeCharacter(input.character);
    const existingIndex = record.characters.findIndex((item) => item.id === character.id);
    const oldName = existingIndex >= 0 ? normalizeCharacter(record.characters[existingIndex]).name.trim() : "";
    record.characters =
      existingIndex >= 0
        ? record.characters.map((item) => (item.id === character.id ? character : normalizeCharacter(item)))
        : [...record.characters.map(normalizeCharacter), character];
    saveProjectRecord(record);
    if (oldName && oldName !== character.name.trim()) {
      applyBrowserRenameSync(
        input.projectPath,
        { kind: "character", id: character.id },
        oldName,
        character.name.trim()
      );
    }
    return structuredClone(getProjectRecord(input.projectPath).characters);
  },
  async listWorldEntries(projectPath: string): Promise<WorldEntry[]> {
    return structuredClone(getProjectRecord(projectPath).worldEntries.map(normalizeWorldEntry));
  },
  async saveWorldEntry(input: SaveWorldEntryInput): Promise<WorldEntry[]> {
    const record = getProjectRecord(input.projectPath);
    const entry = normalizeWorldEntry(input.entry);
    const existingIndex = record.worldEntries.findIndex((item) => item.id === entry.id);
    const oldTitle = existingIndex >= 0 ? normalizeWorldEntry(record.worldEntries[existingIndex]).title.trim() : "";
    record.worldEntries =
      existingIndex >= 0
        ? record.worldEntries.map((item) => (item.id === entry.id ? entry : normalizeWorldEntry(item)))
        : [...record.worldEntries.map(normalizeWorldEntry), entry];
    saveProjectRecord(record);
    if (oldTitle && oldTitle !== entry.title.trim()) {
      applyBrowserRenameSync(input.projectPath, { kind: "world", id: entry.id }, oldTitle, entry.title.trim());
    }
    return structuredClone(getProjectRecord(input.projectPath).worldEntries);
  },
  async listTimeline(projectPath: string): Promise<TimelineEvent[]> {
    return structuredClone(getProjectRecord(projectPath).timeline.map(normalizeTimelineEvent));
  },
  async saveTimelineEvent(input: SaveTimelineEventInput): Promise<TimelineEvent[]> {
    const record = getProjectRecord(input.projectPath);
    const event = normalizeTimelineEvent(input.event);
    const existing = record.timeline.findIndex((item) => item.id === event.id);
    record.timeline =
      existing >= 0
        ? record.timeline.map((item) => (item.id === event.id ? event : normalizeTimelineEvent(item)))
        : [...record.timeline.map(normalizeTimelineEvent), event];
    saveProjectRecord(record);
    return structuredClone(record.timeline);
  },
  async listClues(projectPath: string): Promise<Clue[]> {
    return structuredClone(getProjectRecord(projectPath).clues.map(normalizeClue));
  },
  async saveClue(input: SaveClueInput): Promise<Clue[]> {
    const record = getProjectRecord(input.projectPath);
    const clue = normalizeClue(input.clue);
    const existing = record.clues.findIndex((item) => item.id === clue.id);
    record.clues =
      existing >= 0
        ? record.clues.map((item) => (item.id === clue.id ? clue : normalizeClue(item)))
        : [...record.clues.map(normalizeClue), clue];
    saveProjectRecord(record);
    return structuredClone(record.clues);
  },
  async listTerms(projectPath: string): Promise<Term[]> {
    return structuredClone(getProjectRecord(projectPath).terms.map(normalizeTerm));
  },
  async saveTerm(input: SaveTermInput): Promise<Term[]> {
    const record = getProjectRecord(input.projectPath);
    const term = normalizeTerm(input.term);
    const existing = record.terms.findIndex((item) => item.id === term.id);
    record.terms =
      existing >= 0
        ? record.terms.map((item) => (item.id === term.id ? term : normalizeTerm(item)))
        : [...record.terms.map(normalizeTerm), term];
    saveProjectRecord(record);
    return structuredClone(record.terms);
  },
  async listConflicts(projectPath: string): Promise<Conflict[]> {
    return structuredClone((getProjectRecord(projectPath).conflicts ?? []).map(normalizeConflict));
  },
  async saveConflict(input: { projectPath: string; conflict: Conflict }): Promise<Conflict[]> {
    const record = getProjectRecord(input.projectPath);
    const conflict = normalizeConflict(input.conflict);
    const existing = (record.conflicts ?? []).findIndex((item) => item.id === conflict.id);
    record.conflicts =
      existing >= 0
        ? (record.conflicts ?? []).map((item) => (item.id === conflict.id ? conflict : normalizeConflict(item)))
        : [...(record.conflicts ?? []).map(normalizeConflict), conflict];
    saveProjectRecord(record);
    return structuredClone(record.conflicts);
  },
  async findEntityReferences(projectPath: string, target: StoryEntityRef): Promise<StoryReferenceHit[]> {
    return findStoryReferences(browserReferenceData(projectPath), target);
  },
  async deleteStoryEntity(
    projectPath: string,
    target: StoryEntityRef,
    mode: "force" | "unlink" | "replace",
    replacement = ""
  ): Promise<void> {
    if (mode === "replace" && !replacement.trim()) {
      throw new Error("替换实体时必须提供新的名称。");
    }
    const record = getProjectRecord(projectPath);
    if (mode !== "force") {
      const result = detachStoryReferences(browserReferenceData(projectPath), target, mode, replacement.trim());
      record.characters = result.characters;
      record.worldEntries = result.worldEntries;
      record.timeline = result.timeline;
      record.clues = result.clues;
      record.conflicts = result.conflicts;
      if (result.chaptersChanged) {
        const chapterById = new Map(result.chapters.map((chapter) => [chapter.id, chapter]));
        record.summary = {
          ...record.summary,
          outline: {
            ...record.summary.outline,
            volumes: record.summary.outline.volumes.map((volume) => ({
              ...volume,
              chapters: volume.chapters.map((chapter) => chapterById.get(chapter.id) ?? chapter)
            }))
          }
        };
      }
    }
    switch (target.kind) {
      case "character":
        record.characters = record.characters.filter((item) => item.id !== target.id);
        break;
      case "world":
        record.worldEntries = record.worldEntries.filter((item) => item.id !== target.id);
        break;
      case "timeline":
        record.timeline = record.timeline.filter((item) => item.id !== target.id);
        break;
      case "clue":
        record.clues = record.clues.filter((item) => item.id !== target.id);
        break;
      case "term":
        record.terms = record.terms.filter((item) => item.id !== target.id);
        break;
      case "conflict":
        record.conflicts = (record.conflicts ?? []).filter((item) => item.id !== target.id);
        break;
    }
    saveProjectRecord(record);
  },
  async inspectStory(projectPath: string): Promise<ConsistencyIssue[]> {
    const record = getProjectRecord(projectPath);
    const issues: ConsistencyIssue[] = [];
    for (const clue of record.clues.map(normalizeClue)) {
      if (clue.status !== "resolved" && !clue.expectedPayoff) {
        issues.push({
          id: `clue-${clue.id}`,
          severity: "warning",
          scope: "clue",
          title: "伏笔缺少预期回收",
          detail: clue.title
        });
      }
    }
    for (const term of record.terms.map(normalizeTerm)) {
      if (!term.definition) {
        issues.push({
          id: `term-${term.id}`,
          severity: "info",
          scope: "term",
          title: "术语缺少定义",
          detail: term.name
        });
      }
    }
    return issues.length
      ? issues
      : [
          {
            id: "ok",
            severity: "info",
            scope: "project",
            title: "本地检查通过",
            detail: "没有发现基础结构问题。"
          }
        ];
  },
  async listChapterSummaries(projectPath: string): Promise<
    Array<{
      id: string;
      chapterId: string;
      chapterTitle: string;
      task: string;
      model: string;
      savedAt: string;
      snippet: string;
    }>
  > {
    const record = getProjectRecord(projectPath);
    return Object.entries(record.summaries)
      .map(([key, value]) => {
        const entry = value as Record<string, unknown>;
        const rawText = String(entry.rawOutput ?? entry.summaryText ?? "");
        return {
          id: key,
          chapterId: String(entry.chapterId ?? ""),
          chapterTitle: String(entry.chapterTitle ?? ""),
          task: String(entry.sourceTask ?? "summary"),
          model: String(entry.model ?? ""),
          savedAt: String(entry.savedAt ?? ""),
          snippet: rawText.slice(0, 150)
        };
      })
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  },
  async listPlanningSessions(projectPath: string): Promise<PlanningSession[]> {
    return structuredClone(getProjectRecord(projectPath).planningSessions).sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt)
    );
  },
  async savePlanningSession(projectPath: string, session: PlanningSession): Promise<PlanningSession[]> {
    const record = getProjectRecord(projectPath);
    const updated = {
      ...session,
      package: session.package ? normalizePlanningPackage(record.summary, session.package) : undefined,
      updatedAt: new Date().toISOString()
    };
    record.planningSessions = record.planningSessions.some((item) => item.id === updated.id)
      ? record.planningSessions.map((item) => (item.id === updated.id ? updated : item))
      : [updated, ...record.planningSessions];
    saveProjectRecord(record);
    return structuredClone(record.planningSessions).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },
  async runPlanningAi(input: PlanningAiInput, signal?: AbortSignal): Promise<PlanningSession> {
    const record = getProjectRecord(input.projectPath);
    const session = record.planningSessions.find((item) => item.id === input.sessionId);
    if (!session) {
      throw new Error("Planning session not found.");
    }
    const now = new Date().toISOString();
    const userMessage = input.userMessage?.trim();
    const baseMessages = [
      ...session.messages,
      ...(userMessage
        ? [{ id: `msg_${Date.now()}_user`, role: "user" as const, content: userMessage, createdAt: now }]
        : [])
    ];

    let assistantContent = "";
    let planningPackage = session.package;
    let status = session.status;
    let planError: string | undefined;
    try {
      assistantContent = await runBrowserPlanningRequest(
        input,
        record.summary,
        { ...session, messages: baseMessages },
        signal
      );
      if (input.mode === "package") {
        try {
          planningPackage = normalizePlanningPackage(record.summary, parsePlanningJson(assistantContent));
          status = "ready";
        } catch (jsonError) {
          // AI returned broken JSON — ask AI to fix it
          if (!signal?.aborted) {
            const fixContent = await fixPlanningJson(
              input,
              record.summary,
              { ...session, messages: baseMessages },
              assistantContent,
              (jsonError as Error).message,
              signal
            );
            if (fixContent) {
              assistantContent = fixContent;
              planningPackage = normalizePlanningPackage(record.summary, parsePlanningJson(fixContent));
              status = "ready";
            } else {
              throw jsonError;
            }
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("Provider") || message.includes("not configured")) {
        planError = "请先在 AI 任务面板配置 Provider（Base URL + API Key）。";
      } else if (input.mode === "package") {
        planError = `规划包生成失败：${message}。已生成示例规划包作为参考。`;
        try {
          planningPackage = normalizePlanningPackage(
            record.summary,
            createSamplePlanningPackage(record.summary, userMessage || session.title)
          );
        } catch {
          planningPackage = undefined;
        }
        assistantContent = planningPackage ? JSON.stringify(planningPackage, null, 2) : "{}";
        status = "ready";
      } else {
        planError = `规划追问失败：${message}`;
        assistantContent =
          "为了生成可导入规划包，请补充：主角目标、核心冲突、力量体系、主要反派、前三卷节奏、必须保留或避开的设定。";
      }
    }

    const next: PlanningSession = {
      ...session,
      status,
      package: planningPackage,
      rawOutput: assistantContent,
      messages: [
        ...baseMessages,
        ...(planError
          ? [{ id: `msg_${Date.now()}_error`, role: "system" as const, content: planError, createdAt: now }]
          : []),
        ...(assistantContent
          ? [
              {
                id: `msg_${Date.now()}_assistant`,
                role: "assistant" as const,
                content: assistantContent,
                createdAt: now
              }
            ]
          : [])
      ],
      updatedAt: now
    };
    record.planningSessions = record.planningSessions.map((item) => (item.id === next.id ? next : item));
    saveProjectRecord(record);
    return structuredClone(next);
  },
  async importPlanningPackage(
    projectPath: string,
    sessionId: string,
    selection: PlanningImportSelection
  ): Promise<PlanningImportResult> {
    const record = getProjectRecord(projectPath);
    const session = record.planningSessions.find((item) => item.id === sessionId);
    if (!session?.package) {
      throw new Error("Planning package not found.");
    }
    const snapshotId = `snapshot_${Date.now()}`;
    record.importSnapshots[snapshotId] = {
      id: snapshotId,
      createdAt: new Date().toISOString(),
      outline: record.summary.outline,
      characters: record.characters,
      worldEntries: record.worldEntries,
      timeline: record.timeline,
      clues: record.clues,
      terms: record.terms
    };
    const result: PlanningImportResult = { snapshotId, added: {}, skipped: {}, errors: [] };
    const planningPackage = normalizePlanningPackage(record.summary, session.package);

    for (const item of (planningPackage.characters ?? []).filter((entry) => selection.characters.includes(entry.id))) {
      const parsed = normalizeCharacter(item);
      const conflict = findMatchingItem(record.characters.map(normalizeCharacter), parsed, (entry) => entry.name);
      if (conflict && !shouldOverwrite(selection, "characters", parsed.id)) increment(result.skipped, "characters");
      else {
        replaceOrAppend(record.characters, conflict ? { ...parsed, id: conflict.id } : parsed);
        increment(result.added, conflict ? "charactersUpdated" : "characters");
      }
    }
    for (const item of (planningPackage.worldEntries ?? []).filter((entry) =>
      selection.worldEntries.includes(entry.id)
    )) {
      const parsed = normalizeWorldEntry(item);
      const conflict = findMatchingItem(record.worldEntries.map(normalizeWorldEntry), parsed, (entry) => entry.title);
      if (conflict && !shouldOverwrite(selection, "worldEntries", parsed.id)) increment(result.skipped, "worldEntries");
      else {
        replaceOrAppend(record.worldEntries, conflict ? { ...parsed, id: conflict.id } : parsed);
        increment(result.added, conflict ? "worldEntriesUpdated" : "worldEntries");
      }
    }
    for (const item of (planningPackage.timeline ?? []).filter((entry) => selection.timeline.includes(entry.id))) {
      const parsed = normalizeTimelineEvent(item);
      const conflict = findMatchingItem(record.timeline.map(normalizeTimelineEvent), parsed, (entry) => entry.title);
      if (conflict && !shouldOverwrite(selection, "timeline", parsed.id)) increment(result.skipped, "timeline");
      else {
        replaceOrAppend(record.timeline, conflict ? { ...parsed, id: conflict.id } : parsed);
        increment(result.added, conflict ? "timelineUpdated" : "timeline");
      }
    }
    for (const item of (planningPackage.terms ?? []).filter((entry) => selection.terms.includes(entry.id))) {
      const parsed = normalizeTerm(item);
      const conflict = findMatchingItem(record.terms.map(normalizeTerm), parsed, (entry) => entry.name);
      if (conflict && !shouldOverwrite(selection, "terms", parsed.id)) increment(result.skipped, "terms");
      else {
        replaceOrAppend(record.terms, conflict ? { ...parsed, id: conflict.id } : parsed);
        increment(result.added, conflict ? "termsUpdated" : "terms");
      }
    }
    for (const item of (planningPackage.clues ?? []).filter((entry) => selection.clues.includes(entry.id))) {
      const parsed = normalizeClue(item);
      const conflict = findMatchingItem(record.clues.map(normalizeClue), parsed, (entry) => entry.title);
      if (conflict && !shouldOverwrite(selection, "clues", parsed.id)) increment(result.skipped, "clues");
      else {
        replaceOrAppend(record.clues, conflict ? { ...parsed, id: conflict.id } : parsed);
        increment(result.added, conflict ? "cluesUpdated" : "clues");
      }
    }

    const selectedVolumes = (planningPackage.outline?.volumes ?? []).filter((volume) =>
      selection.outlineVolumeIds.includes(volume.id)
    );
    let nextChapterNumber =
      Math.max(
        0,
        ...record.summary.outline.volumes.flatMap((volume) => volume.chapters.map((chapter) => chapter.number))
      ) + 1;
    for (const volume of selectedVolumes) {
      const conflict = findMatchingItem(record.summary.outline.volumes, volume, (entry) => entry.title);
      if (conflict && !shouldOverwrite(selection, "outlineVolumeIds", volume.id)) {
        increment(result.skipped, "outline");
        continue;
      }
      if (conflict) {
        const volumeIndex = record.summary.outline.volumes.findIndex((entry) => entry.id === conflict.id);
        const volumeNumber = volumeIndex + 1;
        const retainedChapters = [...conflict.chapters];
        const chapters = volume.chapters.map((chapter) => {
          const existingIndex = retainedChapters.findIndex((entry) =>
            sameImportKey(entry, chapter, (candidate) => candidate.title)
          );
          if (existingIndex >= 0) {
            const existing = retainedChapters.splice(existingIndex, 1)[0];
            return {
              ...chapter,
              id: existing.id,
              number: existing.number,
              file: existing.file,
              actualWords: existing.actualWords,
              archived: existing.archived,
              status: chapter.status ?? existing.status ?? "planned"
            };
          }
          const number = nextChapterNumber++;
          return {
            ...chapter,
            id: `ch-${String(number).padStart(4, "0")}`,
            number,
            file: chapterFile(volumeNumber, number),
            status: chapter.status ?? "planned",
            targetWords: chapter.targetWords ?? record.summary.meta.writingPreferences.chapterWords,
            actualWords: chapter.actualWords ?? 0,
            archived: chapter.archived ?? false,
            notes: chapter.notes ?? "",
            conflictPoints: chapter.conflictPoints ?? ""
          };
        });
        for (const chapter of chapters.filter(
          (entry) => !conflict.chapters.some((existing) => existing.file === entry.file)
        )) {
          record.chapterBodies[chapter.file] = "";
        }
        record.summary.outline.volumes[volumeIndex] = {
          ...volume,
          id: conflict.id,
          chapters: [...chapters, ...retainedChapters]
        };
        record.summary.outline.premise = planningPackage.outline.premise || record.summary.outline.premise;
        record.summary.outline.mainConflict =
          planningPackage.outline.mainConflict || record.summary.outline.mainConflict;
        record.summary.outline.endingDirection =
          planningPackage.outline.endingDirection || record.summary.outline.endingDirection;
        increment(result.added, "outlineUpdated");
        continue;
      }
      const volumeNumber = record.summary.outline.volumes.length + 1;
      const chapters = volume.chapters.map((chapter) => {
        const number = nextChapterNumber++;
        return {
          ...chapter,
          id: `ch-${String(number).padStart(4, "0")}`,
          number,
          file: chapterFile(volumeNumber, number),
          status: chapter.status ?? "planned",
          targetWords: chapter.targetWords ?? record.summary.meta.writingPreferences.chapterWords,
          actualWords: chapter.actualWords ?? 0,
          archived: chapter.archived ?? false,
          notes: chapter.notes ?? "",
          conflictPoints: chapter.conflictPoints ?? ""
        };
      });
      for (const chapter of chapters) {
        record.chapterBodies[chapter.file] = "";
      }
      record.summary.outline.volumes.push({ ...volume, id: `vol-${String(volumeNumber).padStart(3, "0")}`, chapters });
      record.summary.outline.premise = planningPackage.outline.premise || record.summary.outline.premise;
      record.summary.outline.mainConflict = planningPackage.outline.mainConflict || record.summary.outline.mainConflict;
      record.summary.outline.endingDirection =
        planningPackage.outline.endingDirection || record.summary.outline.endingDirection;
      increment(result.added, "outline");
    }
    record.planningSessions = record.planningSessions.map((item) =>
      item.id === sessionId ? { ...item, status: "imported", updatedAt: new Date().toISOString() } : item
    );
    saveProjectRecord(record);
    return result;
  },
  async restorePlanningSnapshot(projectPath: string, snapshotId: string): Promise<PlanningImportResult> {
    const record = getProjectRecord(projectPath);
    const snapshot = asRecord(record.importSnapshots[snapshotId]);
    if (!Object.keys(snapshot).length) {
      throw new Error("Planning import snapshot not found.");
    }
    const outline = (record.summary.outline = OutlineSchema.parse(normalizeOutline(record.summary, snapshot.outline)));
    const retainedFiles = new Set(outline.volumes.flatMap((volume) => volume.chapters.map((chapter) => chapter.file)));
    record.chapterBodies = Object.fromEntries(
      Object.entries(record.chapterBodies).filter(([file]) => retainedFiles.has(file))
    );
    for (const chapter of outline.volumes.flatMap((volume) => volume.chapters)) {
      record.chapterBodies[chapter.file] = record.chapterBodies[chapter.file] ?? "";
    }
    record.characters = firstArray(snapshot.characters).map(normalizeCharacter);
    record.worldEntries = firstArray(snapshot.worldEntries).map(normalizeWorldEntry);
    record.timeline = firstArray(snapshot.timeline).map(normalizeTimelineEvent);
    record.clues = firstArray(snapshot.clues).map(normalizeClue);
    record.terms = firstArray(snapshot.terms).map(normalizeTerm);
    saveProjectRecord(record);
    return { snapshotId, added: {}, skipped: {}, errors: [] };
  }
};

const summarizeLibraryContext = (record: ReturnType<typeof getProjectRecord>) => ({
  existingCharacters: record.characters
    .map(normalizeCharacter)
    .slice(0, 12)
    .map((c) => ({
      name: c.name,
      role: c.role,
      identity: c.profile.identity,
      motivation: c.profile.motivation?.slice(0, 80),
      powerLevel: c.currentState.powerLevel
    })),
  existingWorldEntries: record.worldEntries
    .map(normalizeWorldEntry)
    .slice(0, 10)
    .map((w) => ({
      title: w.title,
      type: w.type,
      summary: w.summary?.slice(0, 100),
      locked: w.locked
    })),
  existingTimeline: record.timeline
    .map(normalizeTimelineEvent)
    .slice(0, 10)
    .map((e) => ({
      title: e.title,
      chapterId: e.chapterId,
      location: e.location
    })),
  existingTerms: record.terms
    .map(normalizeTerm)
    .slice(0, 12)
    .map((t) => ({
      name: t.name,
      category: t.category,
      definition: t.definition?.slice(0, 80),
      locked: t.locked
    })),
  existingClues: record.clues
    .map(normalizeClue)
    .slice(0, 8)
    .map((cl) => ({
      title: cl.title,
      status: cl.status,
      plantedChapterId: cl.plantedChapterId,
      expectedPayoff: cl.expectedPayoff?.slice(0, 100)
    }))
});

const loadPlanningTemplate = (record: ReturnType<typeof getProjectRecord>, mode: PlanningMode): PromptTemplate => {
  const fileName = promptPlanningTemplateFileName(mode);
  try {
    if (record.prompts[fileName]) {
      return record.prompts[fileName] as PromptTemplate;
    }
  } catch {
    /* fall through */
  }
  return createDefaultPlanningPrompt(mode);
};

const runBrowserPlanningRequest = async (
  input: PlanningAiInput,
  project: ProjectSummary,
  session: PlanningSession,
  signal?: AbortSignal
): Promise<string> => {
  const provider = readProviderStorage();
  if (!hasAuthMaterial(provider.authMode, provider.apiKey)) {
    throw new Error("Provider is not configured.");
  }
  const record = getProjectRecord(input.projectPath);
  const libraryContext = summarizeLibraryContext(record);
  const template = loadPlanningTemplate(record, input.mode);
  const historyText = JSON.stringify(session.messages.map((m) => ({ role: m.role, content: m.content })));
  const rendered = renderPrompt(template, {
    mode: input.mode,
    projectTitle: project.meta.title,
    premise: project.outline.premise,
    userMessage: input.userMessage || "",
    existingCharacters: JSON.stringify(libraryContext.existingCharacters),
    existingWorldEntries: JSON.stringify(libraryContext.existingWorldEntries),
    existingTimeline: JSON.stringify(libraryContext.existingTimeline),
    existingTerms: JSON.stringify(libraryContext.existingTerms),
    existingClues: JSON.stringify(libraryContext.existingClues),
    currentPackage: JSON.stringify(session.package ?? {}),
    history: historyText
  });
  const response = await fetch("/__inkforge_ai/chat-completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      baseUrl: provider.baseUrl,
      authMode: provider.authMode,
      apiKey: provider.apiKey,
      payload: {
        model: provider.model,
        temperature: provider.temperature,
        max_tokens: input.mode === "package" ? Math.max(provider.maxTokens, 4096) : provider.maxTokens,
        stream: false,
        messages: [
          { role: "system", content: rendered.system },
          { role: "user", content: rendered.user }
        ]
      }
    }),
    signal
  });
  const payload = (await response.json().catch(() => ({}))) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(payload.error?.message || `Planning request failed: ${response.status}`);
  }
  const text = payload.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new Error("Planning request returned empty text.");
  }
  return text;
};

const fixPlanningJson = async (
  input: PlanningAiInput,
  project: ProjectSummary,
  session: PlanningSession,
  brokenJson: string,
  parseError: string,
  signal?: AbortSignal
): Promise<string | null> => {
  const provider = readProviderStorage();
  if (!hasAuthMaterial(provider.authMode, provider.apiKey)) {
    return null;
  }
  try {
    const response = await fetch("/__inkforge_ai/chat-completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        baseUrl: provider.baseUrl,
        authMode: provider.authMode,
        apiKey: provider.apiKey,
        payload: {
          model: provider.model,
          temperature: 0.2,
          max_tokens: Math.max(provider.maxTokens, 4096),
          stream: false,
          messages: [
            {
              role: "system",
              content:
                "You are a JSON repair tool. The user will provide broken JSON and a parse error. Output ONLY the corrected valid JSON with no explanation, no markdown fences, no extra text."
            },
            {
              role: "user",
              content: `Parse error: ${parseError}\n\nBroken JSON:\n${brokenJson.slice(-8000)}`
            }
          ]
        }
      }),
      signal
    });
    const payload = (await response.json().catch(() => ({}))) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    if (!response.ok) return null;
    const text = payload.choices?.[0]?.message?.content?.trim();
    return text || null;
  } catch {
    return null;
  }
};

const stripJsonFence = (text: string): string => {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced?.[1] ?? text).trim();
};

const repairLlmJson = (raw: string): string => {
  const repaired = raw
    // Remove trailing commas before } or ]
    .replace(/,(\s*[}\]])/g, "$1")
    // Quote unquoted property names: {name: -> {"name":
    .replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, '$1"$2":')
    // Single-quoted strings → double-quoted (simple case, no escapes)
    .replace(/'([^'\\]*)'/g, '"$1"');
  return repaired;
};

const parsePlanningJson = (text: string): unknown => {
  const raw = stripJsonFence(text);
  try {
    return JSON.parse(raw);
  } catch {
    try {
      return JSON.parse(repairLlmJson(raw));
    } catch (repairError) {
      throw new Error(`JSON parse failed after repair. Original: ${(repairError as Error).message.slice(0, 120)}`);
    }
  }
};

const createSamplePlanningPackage = (project: ProjectSummary, seed: string): PlanningPackage => ({
  meta: {
    title: `${project.meta.title} 规划包`,
    logline: seed || project.outline.premise,
    theme: "",
    sellingPoints: []
  },
  worldEntries: [],
  characters: [],
  timeline: [],
  terms: [],
  clues: [],
  outline: structuredClone(project.outline)
});

const increment = (target: Record<string, number>, key: string): void => {
  target[key] = (target[key] ?? 0) + 1;
};

type PlanningImportOverwriteKey = keyof NonNullable<PlanningImportSelection["overwrite"]>;

const normalizeImportKey = (value: string): string => value.trim().toLowerCase();

const sameImportKey = <T extends { id: string }>(existing: T, incoming: T, label: (item: T) => string): boolean =>
  existing.id === incoming.id || normalizeImportKey(label(existing)) === normalizeImportKey(label(incoming));

const findMatchingItem = <T extends { id: string }>(
  items: T[],
  incoming: T,
  label: (item: T) => string
): T | undefined => items.find((entry) => sameImportKey(entry, incoming, label));

const shouldOverwrite = (selection: PlanningImportSelection, key: PlanningImportOverwriteKey, id: string): boolean =>
  Boolean(selection.overwrite?.[key]?.includes(id));

const replaceOrAppend = <T extends { id: string }>(items: T[], item: T): void => {
  const index = items.findIndex((entry) => entry.id === item.id);
  if (index >= 0) {
    items[index] = item;
  } else {
    items.push(item);
  }
};

const normalizePlanningPackage = (project: ProjectSummary, value: unknown): PlanningPackage => {
  const item = asRecord(value);
  const meta = asRecord(item.meta);
  return PlanningPackageSchema.parse({
    meta: {
      title: nonEmptyText(meta.title ?? item.title, `${project.meta.title} planning package`),
      logline: text(meta.logline ?? item.logline),
      theme: text(meta.theme ?? item.theme),
      sellingPoints: textArray(meta.sellingPoints ?? item.sellingPoints)
    },
    worldEntries: firstArray(item.worldEntries, item.world, item.worldbuilding, item.settings).map(normalizeWorldEntry),
    characters: firstArray(item.characters, item.roles).map(normalizeCharacter),
    timeline: firstArray(item.timeline, item.events).map(normalizeTimelineEvent),
    terms: firstArray(item.terms, item.glossary, item.levels).map(normalizeTerm),
    clues: firstArray(item.clues, item.foreshadowing).map(normalizeClue),
    outline: normalizeOutline(project, item.outline ?? item.plotOutline)
  });
};

const normalizeOutline = (project: ProjectSummary, value: unknown) => {
  const item = asRecord(value);
  return {
    schemaVersion: inkforgeSchemaVersion,
    premise: text(item.premise) || project.outline.premise,
    mainConflict: text(item.mainConflict) || project.outline.mainConflict,
    endingDirection: text(item.endingDirection ?? item.ending) || project.outline.endingDirection,
    volumes: firstArray(item.volumes, item.arcs).map(normalizeVolume)
  };
};

const normalizeVolume = (value: unknown, index: number) => {
  const item = asRecord(value);
  const targetWords = Number(item.targetWords);
  return {
    id: nonEmptyText(item.id, fallbackId("vol", item.title ?? index + 1)),
    title: nonEmptyText(item.title ?? item.name, `Volume ${index + 1}`),
    goal: text(item.goal ?? item.summary),
    targetWords: Number.isFinite(targetWords) && targetWords > 0 ? targetWords : 90000,
    chapters: firstArray(item.chapters, item.chapterPlans).map(normalizeChapter)
  };
};

const chapterStatuses = new Set(["unplanned", "planned", "drafting", "revising", "done"]);

const normalizeChapter = (value: unknown, index: number) => {
  const item = asRecord(value);
  const number = Number(item.number);
  const targetWords = Number(item.targetWords);
  const actualWords = Number(item.actualWords);
  const status = chapterStatuses.has(text(item.status)) ? text(item.status) : "planned";
  return {
    id: nonEmptyText(item.id, fallbackId("planning_ch", item.title ?? index + 1)),
    number: Number.isFinite(number) && number > 0 ? number : index + 1,
    title: nonEmptyText(item.title ?? item.name, `Chapter ${index + 1}`),
    file: text(item.file) || "planning.md",
    goal: text(item.goal ?? item.summary),
    hook: text(item.hook),
    status,
    targetWords: Number.isFinite(targetWords) && targetWords > 0 ? targetWords : 3000,
    actualWords: Number.isFinite(actualWords) && actualWords >= 0 ? actualWords : 0,
    archived: item.archived === true,
    notes: text(item.notes),
    conflictPoints: text(item.conflictPoints ?? item.conflict),
    characters: textArray(item.characters),
    worldRefs: textArray(item.worldRefs ?? item.worldEntries ?? item.settings)
  };
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const text = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "";
  }
  return typeof value === "string" ? value : String(value);
};

const nonEmptyText = (value: unknown, fallback: string): string => {
  const next = text(value).trim();
  return next || fallback;
};

const firstArray = (...values: unknown[]): unknown[] => {
  for (const value of values) {
    if (Array.isArray(value)) {
      return value;
    }
  }
  return [];
};

const firstText = (...values: unknown[]): string => {
  for (const value of values) {
    const next = text(value).trim();
    if (next) {
      return next;
    }
  }
  return "";
};

const textListItem = (value: unknown): string => {
  const record = asRecord(value);
  if (Object.keys(record).length) {
    return firstText(record.name, record.title, record.id, record.summary);
  }
  return text(value);
};

const textArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .map(textListItem)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[,，;；、\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
};

const stringifyExtra = (value: unknown): string => {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return text(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return text(value);
  }
};

const extraDetails = (item: Record<string, unknown>, knownKeys: string[]): string => {
  const known = new Set(knownKeys);
  return Object.entries(item)
    .filter(([key, value]) => !known.has(key) && stringifyExtra(value))
    .map(([key, value]) => `${key}: ${stringifyExtra(value)}`)
    .join("\n");
};

const appendExtra = (base: string, extra: string): string => [base.trim(), extra.trim()].filter(Boolean).join("\n\n");

const fallbackId = (prefix: string, label: unknown): string => {
  const slug = text(label)
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${prefix}_${slug || Date.now()}`;
};

const normalizeCharacter = (value: unknown): Character => {
  const item = asRecord(value);
  const profile = asRecord(item.profile);
  const currentState = asRecord(item.currentState);
  const extras = extraDetails(item, [
    "id",
    "name",
    "aliases",
    "role",
    "tags",
    "profile",
    "currentState",
    "voiceNotes",
    "age",
    "identity",
    "motivation",
    "goal",
    "desire",
    "personality",
    "traits",
    "arc",
    "stage",
    "volume",
    "powerLevel",
    "level",
    "realm",
    "currentLevel",
    "location",
    "relationships",
    "secrets",
    "voice",
    "dialogueStyle",
    "speech",
    "notes"
  ]);
  return CharacterSchema.parse({
    id: nonEmptyText(item.id, fallbackId("char", item.name)),
    name: nonEmptyText(item.name, "Untitled Character"),
    aliases: textArray(item.aliases),
    role: nonEmptyText(item.role, "supporting"),
    tags: textArray(item.tags),
    profile: {
      age: firstText(profile.age, item.age),
      identity: firstText(profile.identity, item.identity),
      motivation: firstText(profile.motivation, item.motivation, item.goal, item.desire),
      personality: firstText(profile.personality, item.personality, item.traits)
    },
    currentState: {
      arc: firstText(currentState.arc, item.arc, item.stage, item.volume),
      powerLevel: firstText(currentState.powerLevel, item.powerLevel, item.level, item.realm, item.currentLevel),
      location: firstText(currentState.location, item.location),
      relationships: textArray(currentState.relationships ?? item.relationships),
      secrets: textArray(currentState.secrets ?? item.secrets)
    },
    voiceNotes: appendExtra(firstText(item.voiceNotes, item.voice, item.dialogueStyle, item.speech, item.notes), extras)
  });
};

const worldEntryTypes = new Set<WorldEntry["type"]>([
  "faction",
  "location",
  "rule",
  "power-system",
  "item",
  "skill",
  "history",
  "race",
  "organization",
  "note"
]);

const normalizeWorldEntryType = (value: unknown): WorldEntry["type"] => {
  const raw = text(value).trim();
  const normalized = raw.toLowerCase();
  if (worldEntryTypes.has(normalized as WorldEntry["type"])) {
    return normalized as WorldEntry["type"];
  }
  const aliases: Array<[WorldEntry["type"], string[]]> = [
    ["faction", ["faction", "势力", "阵营", "派系"]],
    ["location", ["location", "地点", "地理", "城市", "场景", "区域"]],
    ["rule", ["rule", "规则", "法则", "制度"]],
    ["power-system", ["power", "power-system", "cultivation", "修炼", "修炼体系", "力量体系", "境界体系", "能力体系"]],
    ["item", ["item", "物品", "道具", "法宝", "装备"]],
    ["skill", ["skill", "技能", "功法", "术法", "招式"]],
    ["history", ["history", "历史", "历史事件", "往事"]],
    ["race", ["race", "种族", "族群"]],
    ["organization", ["organization", "组织", "宗门", "门派", "机构"]],
    ["note", ["note", "设定", "世界观", "备注", "其他"]]
  ];
  return (
    aliases.find(([, values]) =>
      values.some((alias) => normalized.includes(alias.toLowerCase()) || raw.includes(alias))
    )?.[0] ?? "note"
  );
};

const normalizeWorldEntry = (value: unknown): WorldEntry => {
  const item = asRecord(value);
  const rawType = text(item.type).trim();
  const type = normalizeWorldEntryType(item.type);
  const tags = new Set(textArray(item.tags));
  if (rawType && rawType !== type) {
    tags.add(rawType);
  }
  const extras = extraDetails(item, [
    "id",
    "title",
    "name",
    "type",
    "locked",
    "tags",
    "summary",
    "content",
    "description",
    "desc",
    "brief",
    "details",
    "detail",
    "body",
    "rules",
    "relatedCharacters",
    "relatedClues"
  ]);
  return WorldEntrySchema.parse({
    id: nonEmptyText(item.id, fallbackId("world", item.title ?? item.name)),
    title: nonEmptyText(item.title ?? item.name, "Untitled World Entry"),
    type,
    locked: item.locked === true,
    tags: [...tags],
    summary: firstText(item.summary, item.description, item.desc, item.brief),
    content: appendExtra(firstText(item.content, item.details, item.detail, item.body, item.rules), extras),
    relatedCharacters: textArray(item.relatedCharacters),
    relatedClues: textArray(item.relatedClues)
  });
};

const normalizeTimelineEvent = (value: unknown): TimelineEvent => {
  const item = asRecord(value);
  const order = Number(item.order);
  const extras = extraDetails(item, [
    "id",
    "chapterId",
    "chapter",
    "order",
    "title",
    "name",
    "event",
    "location",
    "place",
    "participants",
    "characters",
    "summary",
    "description",
    "detail",
    "content"
  ]);
  return TimelineEventSchema.parse({
    id: nonEmptyText(item.id, fallbackId("event", item.title ?? item.name ?? item.event)),
    chapterId: firstText(item.chapterId, item.chapter),
    order: Number.isFinite(order) ? order : 0,
    title: nonEmptyText(item.title ?? item.name ?? item.event, "Untitled Event"),
    location: firstText(item.location, item.place),
    participants: textArray(item.participants ?? item.characters),
    summary: appendExtra(firstText(item.summary, item.description, item.detail, item.content), extras)
  });
};

const clueStatuses = new Set<Clue["status"]>(["planned", "planted", "developed", "resolved", "abandoned"]);

const normalizeClue = (value: unknown): Clue => {
  const item = asRecord(value);
  const status = clueStatuses.has(item.status as Clue["status"]) ? item.status : "planned";
  const extras = extraDetails(item, [
    "id",
    "title",
    "name",
    "plantedChapterId",
    "chapterId",
    "relatedCharacters",
    "characters",
    "expectedPayoff",
    "payoff",
    "status",
    "notes",
    "description",
    "detail"
  ]);
  return ClueSchema.parse({
    id: nonEmptyText(item.id, fallbackId("clue", item.title ?? item.name)),
    title: nonEmptyText(item.title ?? item.name, "Untitled Clue"),
    plantedChapterId: firstText(item.plantedChapterId, item.chapterId),
    relatedCharacters: textArray(item.relatedCharacters ?? item.characters),
    expectedPayoff: firstText(item.expectedPayoff, item.payoff),
    status,
    notes: appendExtra(firstText(item.notes, item.description, item.detail), extras)
  });
};

const normalizeTerm = (value: unknown): Term => {
  const item = asRecord(value);
  const extras = extraDetails(item, [
    "id",
    "name",
    "title",
    "category",
    "type",
    "aliases",
    "definition",
    "description",
    "summary",
    "content",
    "locked"
  ]);
  return TermSchema.parse({
    id: nonEmptyText(item.id, fallbackId("term", item.name ?? item.title)),
    name: nonEmptyText(item.name ?? item.title, "Untitled Term"),
    category: nonEmptyText(item.category ?? item.type, "term"),
    aliases: textArray(item.aliases),
    definition: appendExtra(firstText(item.definition, item.description, item.summary, item.content), extras),
    locked: item.locked === true
  });
};

const normalizeConflict = (value: unknown): Conflict => ConflictSchema.parse(value);

const browserReferenceData = (projectPath: string): StoryReferenceData => {
  const record = getProjectRecord(projectPath);
  return {
    characters: record.characters.map(normalizeCharacter),
    worldEntries: record.worldEntries.map(normalizeWorldEntry),
    timeline: record.timeline.map(normalizeTimelineEvent),
    clues: record.clues.map(normalizeClue),
    terms: record.terms.map(normalizeTerm),
    conflicts: (record.conflicts ?? []).map(normalizeConflict),
    chapters: record.summary.outline.volumes.flatMap((volume) => volume.chapters)
  };
};

const applyBrowserRenameSync = (
  projectPath: string,
  target: StoryEntityRef,
  oldName: string,
  newName: string
): void => {
  const result = renameStoryReferences(browserReferenceData(projectPath), target, oldName, newName);
  const record = getProjectRecord(projectPath);
  record.characters = result.characters;
  record.worldEntries = result.worldEntries;
  record.timeline = result.timeline;
  record.clues = result.clues;
  record.conflicts = result.conflicts;
  if (result.chaptersChanged) {
    const chapterById = new Map(result.chapters.map((chapter) => [chapter.id, chapter]));
    record.summary = {
      ...record.summary,
      outline: {
        ...record.summary.outline,
        volumes: record.summary.outline.volumes.map((volume) => ({
          ...volume,
          chapters: volume.chapters.map((chapter) => chapterById.get(chapter.id) ?? chapter)
        }))
      }
    };
  }
  saveProjectRecord(record);
};
