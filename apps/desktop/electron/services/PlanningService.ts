import { readdir, unlink } from "node:fs/promises";
import path from "node:path";
import {
  authHeaders,
  classifyProviderError,
  completionsUrl,
  type ChatCompletionRequest,
  type ChatCompletionResponse
} from "@inkforge/ai-provider";
import {
  CharacterSchema,
  ClueSchema,
  inkforgeSchemaVersion,
  OutlineSchema,
  PlanningImportResultSchema,
  PlanningImportSelectionSchema,
  PlanningPackageSchema,
  PlanningSessionSchema,
  TermSchema,
  TimelineEventSchema,
  WorldEntrySchema,
  type ChapterPlan,
  type Character,
  type Clue,
  type Outline,
  type PlanningImportResult,
  type PlanningImportSelection,
  type PlanningPackage,
  type PlanningSession,
  type Term,
  type TimelineEvent,
  type VolumePlan,
  type WorldEntry
} from "@inkforge/schemas";
import type { PlanningAiInput } from "../types.js";
import { FileRepository } from "./FileRepository.js";
import { LibraryService } from "./LibraryService.js";
import { ProjectService } from "./ProjectService.js";
import { SecureConfigService } from "./SecureConfigService.js";
import { StoryStateService } from "./StoryStateService.js";

export class PlanningService {
  private readonly activeRequests = new Map<string, AbortController>();

  constructor(
    private readonly files = new FileRepository(),
    private readonly projects = new ProjectService(files),
    private readonly library = new LibraryService(files),
    private readonly story = new StoryStateService(files, projects),
    private readonly secureConfig = new SecureConfigService(files)
  ) {}

  async listSessions(projectPath: string): Promise<PlanningSession[]> {
    try {
      const raw = await this.files.readJson<unknown[]>(
        this.files.assertInsideProject(projectPath, ".inkforge/planning-sessions.json")
      );
      return raw
        .map((item) => PlanningSessionSchema.parse(item))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    } catch {
      return [];
    }
  }

  async saveSession(projectPath: string, session: PlanningSession): Promise<PlanningSession[]> {
    const parsed = PlanningSessionSchema.parse({ ...session, updatedAt: new Date().toISOString() });
    const sessions = await this.listSessions(projectPath);
    const next = upsertById(sessions, parsed);
    await this.files.writeJsonAtomic(
      this.files.assertInsideProject(projectPath, ".inkforge/planning-sessions.json"),
      next
    );
    return next;
  }

  cancelRun(requestId: string): void {
    this.activeRequests.get(requestId)?.abort();
  }

  async runAi(input: PlanningAiInput): Promise<PlanningSession> {
    const abortController = input.requestId ? new AbortController() : undefined;
    if (input.requestId && abortController) {
      this.activeRequests.set(input.requestId, abortController);
    }
    try {
      const sessions = await this.listSessions(input.projectPath);
      const session = sessions.find((item) => item.id === input.sessionId);
      if (!session) {
        throw new Error("Planning session not found.");
      }
      const project = await this.projects.openProject(input.projectPath);
      const provider = await this.secureConfig.getProvider();
      if (provider.authMode !== "none" && !provider.apiKey) {
        throw new Error("Provider is not configured.");
      }

      const [characters, worldEntries, timeline, terms, clues] = await Promise.all([
        this.library.listCharacters(input.projectPath).catch(() => [] as Character[]),
        this.library.listWorldEntries(input.projectPath).catch(() => [] as WorldEntry[]),
        this.story.listTimeline(input.projectPath).catch(() => [] as TimelineEvent[]),
        this.story.listTerms(input.projectPath).catch(() => [] as Term[]),
        this.story.listClues(input.projectPath).catch(() => [] as Clue[])
      ]);

      const libraryContext = {
        existingCharacters: characters.slice(0, 12).map((c) => ({
          name: c.name,
          role: c.role,
          identity: c.profile.identity,
          motivation: c.profile.motivation?.slice(0, 80),
          powerLevel: c.currentState.powerLevel
        })),
        existingWorldEntries: worldEntries.slice(0, 10).map((w) => ({
          title: w.title,
          type: w.type,
          summary: w.summary?.slice(0, 100),
          locked: w.locked
        })),
        existingTimeline: timeline.slice(0, 10).map((e) => ({
          title: e.title,
          chapterId: e.chapterId,
          location: e.location
        })),
        existingTerms: terms.slice(0, 12).map((t) => ({
          name: t.name,
          category: t.category,
          definition: t.definition?.slice(0, 80),
          locked: t.locked
        })),
        existingClues: clues.slice(0, 8).map((cl) => ({
          title: cl.title,
          status: cl.status,
          plantedChapterId: cl.plantedChapterId,
          expectedPayoff: cl.expectedPayoff?.slice(0, 100)
        }))
      };

      const body: ChatCompletionRequest = {
        model: provider.model,
        temperature: provider.temperature,
        max_tokens: input.mode === "package" ? Math.max(provider.maxTokens, 4096) : provider.maxTokens,
        stream: false,
        messages: [
          { role: "system", content: planningSystemPrompt(input.mode) },
          {
            role: "user",
            content: JSON.stringify({
              mode: input.mode,
              projectTitle: project.meta.title,
              premise: project.outline.premise,
              userMessage: input.userMessage,
              messages: session.messages.map((item) => ({ role: item.role, content: item.content })),
              currentPackage: session.package,
              ...libraryContext
            })
          }
        ]
      };

      const response = await fetch(completionsUrl(provider.baseUrl), {
        method: "POST",
        signal: abortController?.signal,
        headers: {
          "content-type": "application/json",
          ...authHeaders(provider.authMode, provider.apiKey)
        },
        body: JSON.stringify(body)
      });
      const payload = (await response.json().catch(() => ({}))) as ChatCompletionResponse;
      if (!response.ok) {
        throw new Error(classifyProviderError(response.status, payload));
      }
      let text = payload.choices?.[0]?.message?.content?.trim() ?? "";
      if (!text) {
        throw new Error("Planning AI returned empty output.");
      }

      const now = new Date().toISOString();
      const next: PlanningSession = {
        ...session,
        messages: [
          ...session.messages,
          ...(input.userMessage
            ? [{ id: `msg_${Date.now()}_user`, role: "user" as const, content: input.userMessage, createdAt: now }]
            : []),
          { id: `msg_${Date.now()}_assistant`, role: "assistant", content: text, createdAt: now }
        ],
        rawOutput: text,
        updatedAt: now
      };

      if (input.mode === "package") {
        const planningPackage = await this.parsePlanningPackageWithRepair(
          text,
          project,
          provider,
          abortController?.signal
        );
        text = JSON.stringify(planningPackage, null, 2);
        next.package = planningPackage;
        next.rawOutput = text;
        next.messages = next.messages.map((message) =>
          message.id.endsWith("_assistant") ? { ...message, content: text } : message
        );
        next.status = "ready";
      }

      await this.saveSession(input.projectPath, next);
      return next;
    } finally {
      if (input.requestId) {
        this.activeRequests.delete(input.requestId);
      }
    }
  }

  private async parsePlanningPackageWithRepair(
    text: string,
    project: Awaited<ReturnType<ProjectService["openProject"]>>,
    provider: Awaited<ReturnType<SecureConfigService["getProvider"]>>,
    signal?: AbortSignal
  ): Promise<PlanningPackage> {
    try {
      return normalizePlanningPackage(project, parseJsonFromText(text));
    } catch (error) {
      const repairText = await this.repairPlanningPackageJson(text, formatPlanningError(error), provider, signal);
      if (!repairText) {
        throw error;
      }
      try {
        return normalizePlanningPackage(project, parseJsonFromText(repairText));
      } catch {
        throw error;
      }
    }
  }

  private async repairPlanningPackageJson(
    brokenJson: string,
    validationError: string,
    provider: Awaited<ReturnType<SecureConfigService["getProvider"]>>,
    signal?: AbortSignal
  ): Promise<string | null> {
    if (provider.authMode !== "none" && !provider.apiKey) {
      return null;
    }
    try {
      const repairBody: ChatCompletionRequest = {
        model: provider.model,
        temperature: 0.2,
        max_tokens: Math.max(provider.maxTokens, 4096),
        stream: false,
        messages: [
          {
            role: "system",
            content: [
              "You repair InkForge planning package JSON.",
              "Output ONLY valid JSON. No markdown fences, no explanation.",
              "Required root keys: meta, worldEntries, characters, timeline, terms, clues, outline.",
              "meta.title is required.",
              "worldEntries[].type must be one of: faction, location, rule, power-system, item, skill, history, race, organization, note.",
              "timeline[].order must be a number and timeline[].title is required.",
              `outline must be an object with schemaVersion ${inkforgeSchemaVersion}, premise, mainConflict, endingDirection, volumes. If the broken outline is an array, put it in outline.volumes.`
            ].join("\n")
          },
          {
            role: "user",
            content: `Validation error:\n${validationError}\n\nBroken JSON:\n${stripJsonFence(brokenJson).slice(-12000)}`
          }
        ]
      };
      const response = await fetch(completionsUrl(provider.baseUrl), {
        method: "POST",
        signal,
        headers: {
          "content-type": "application/json",
          ...authHeaders(provider.authMode, provider.apiKey)
        },
        body: JSON.stringify(repairBody)
      });
      const payload = (await response.json().catch(() => ({}))) as ChatCompletionResponse;
      if (!response.ok) {
        return null;
      }
      return payload.choices?.[0]?.message?.content?.trim() || null;
    } catch {
      return null;
    }
  }

  async importPackage(
    projectPath: string,
    sessionId: string,
    selection: PlanningImportSelection
  ): Promise<PlanningImportResult> {
    const parsedSelection = PlanningImportSelectionSchema.parse(selection);
    const sessions = await this.listSessions(projectPath);
    const session = sessions.find((item) => item.id === sessionId);
    if (!session?.package) {
      throw new Error("Planning package not found.");
    }
    const planningPackage = PlanningPackageSchema.parse(session.package);
    const snapshotId = await this.createSnapshot(projectPath);
    const result = PlanningImportResultSchema.parse({
      snapshotId,
      added: {},
      skipped: {},
      errors: []
    });

    await this.importCharacters(projectPath, planningPackage, parsedSelection, result);
    await this.importWorld(projectPath, planningPackage, parsedSelection, result);
    await this.importTimeline(projectPath, planningPackage, parsedSelection, result);
    await this.importTerms(projectPath, planningPackage, parsedSelection, result);
    await this.importClues(projectPath, planningPackage, parsedSelection, result);
    await this.importOutline(projectPath, planningPackage, parsedSelection, result);

    await this.saveSession(projectPath, { ...session, status: "imported", updatedAt: new Date().toISOString() });
    return result;
  }

  private async createSnapshot(projectPath: string): Promise<string> {
    const snapshotId = `snapshot_${Date.now()}`;
    const project = await this.projects.openProject(projectPath);
    const snapshot = {
      id: snapshotId,
      createdAt: new Date().toISOString(),
      outline: project.outline,
      characters: await this.library.listCharacters(projectPath),
      worldEntries: await this.library.listWorldEntries(projectPath),
      timeline: await this.story.listTimeline(projectPath),
      clues: await this.story.listClues(projectPath),
      terms: await this.story.listTerms(projectPath)
    };
    await this.files.writeJsonAtomic(
      this.files.assertInsideProject(
        projectPath,
        path.posix.join(".inkforge", "import-snapshots", `${snapshotId}.json`)
      ),
      snapshot
    );
    return snapshotId;
  }

  async restoreSnapshot(projectPath: string, snapshotId: string): Promise<PlanningImportResult> {
    const snapshot = await this.readSnapshot(projectPath, snapshotId);
    const currentProject = await this.projects.openProject(projectPath);
    await this.removeChapterFilesOutsideSnapshot(projectPath, currentProject.outline, snapshot.outline);
    await Promise.all([
      this.replaceCharacterFiles(projectPath, snapshot.characters),
      this.replaceWorldEntryFiles(projectPath, snapshot.worldEntries)
    ]);
    await Promise.all([
      this.files.writeJsonAtomic(this.files.assertInsideProject(projectPath, "outline.json"), snapshot.outline),
      this.files.writeJsonAtomic(this.files.assertInsideProject(projectPath, "timeline.json"), snapshot.timeline),
      this.files.writeJsonAtomic(this.files.assertInsideProject(projectPath, "clues.json"), snapshot.clues),
      this.files.writeJsonAtomic(this.files.assertInsideProject(projectPath, "terms.json"), snapshot.terms)
    ]);
    return PlanningImportResultSchema.parse({
      snapshotId,
      added: {},
      skipped: {},
      errors: []
    });
  }

  private async readSnapshot(projectPath: string, snapshotId: string): Promise<PlanningImportSnapshot> {
    const raw = await this.files.readJson<unknown>(
      this.files.assertInsideProject(
        projectPath,
        path.posix.join(".inkforge", "import-snapshots", `${snapshotId}.json`)
      )
    );
    const item = asRecord(raw);
    return {
      id: nonEmptyText(item.id, snapshotId),
      createdAt: nonEmptyText(item.createdAt, new Date().toISOString()),
      outline: OutlineSchema.parse(item.outline),
      characters: firstArray(item.characters).map((entry) => CharacterSchema.parse(entry)),
      worldEntries: firstArray(item.worldEntries).map((entry) => WorldEntrySchema.parse(entry)),
      timeline: firstArray(item.timeline).map((entry) => TimelineEventSchema.parse(entry)),
      clues: firstArray(item.clues).map((entry) => ClueSchema.parse(entry)),
      terms: firstArray(item.terms).map((entry) => TermSchema.parse(entry))
    };
  }

  private async replaceCharacterFiles(projectPath: string, characters: Character[]): Promise<void> {
    const dir = this.files.assertInsideProject(projectPath, "characters");
    await this.files.ensureDir(dir);
    await this.unlinkMatchingFiles(dir, (name) => name.endsWith(".json"));
    for (const character of characters) {
      await this.library.saveCharacter(projectPath, character);
    }
  }

  private async replaceWorldEntryFiles(projectPath: string, worldEntries: WorldEntry[]): Promise<void> {
    const dir = this.files.assertInsideProject(projectPath, "world");
    await this.files.ensureDir(dir);
    const names = await this.readDirectoryNames(dir);
    const markdownIds = new Set(
      names.filter((name) => name.endsWith(".md")).map((name) => name.replace(/\.md$/iu, ""))
    );
    await this.unlinkMatchingFiles(dir, (name) => name.endsWith(".world.json"));
    for (const entry of worldEntries) {
      if (markdownIds.has(entry.id)) {
        continue;
      }
      await this.library.saveWorldEntry(projectPath, entry);
    }
  }

  private async removeChapterFilesOutsideSnapshot(
    projectPath: string,
    current: Outline,
    snapshot: Outline
  ): Promise<void> {
    const snapshotFiles = new Set(snapshot.volumes.flatMap((volume) => volume.chapters.map((chapter) => chapter.file)));
    const currentFiles = current.volumes.flatMap((volume) => volume.chapters.map((chapter) => chapter.file));
    for (const file of currentFiles.filter((entry) => !snapshotFiles.has(entry))) {
      if (!file.startsWith("chapters/")) {
        continue;
      }
      const fullPath = this.files.assertInsideProject(projectPath, file);
      await unlink(fullPath).catch(() => undefined);
    }
  }

  private async unlinkMatchingFiles(dir: string, predicate: (name: string) => boolean): Promise<void> {
    for (const name of await this.readDirectoryNames(dir)) {
      if (predicate(name)) {
        await unlink(path.join(dir, name)).catch(() => undefined);
      }
    }
  }

  private async readDirectoryNames(dir: string): Promise<string[]> {
    try {
      return await readdir(dir);
    } catch {
      return [];
    }
  }

  private async importCharacters(
    projectPath: string,
    planningPackage: PlanningPackage,
    selection: PlanningImportSelection,
    result: PlanningImportResult
  ): Promise<void> {
    const existing = await this.library.listCharacters(projectPath);
    for (const item of (planningPackage.characters ?? []).filter((entry) => selection.characters.includes(entry.id))) {
      const parsed = CharacterSchema.parse(item);
      const conflict = findMatchingItem(existing, parsed, (entry) => entry.name);
      if (conflict && !shouldOverwrite(selection, "characters", parsed.id)) {
        increment(result.skipped, "characters");
        continue;
      }
      const next = conflict ? { ...parsed, id: conflict.id } : parsed;
      await this.library.saveCharacter(projectPath, next);
      replaceOrAppend(existing, next);
      increment(result.added, conflict ? "charactersUpdated" : "characters");
    }
  }

  private async importWorld(
    projectPath: string,
    planningPackage: PlanningPackage,
    selection: PlanningImportSelection,
    result: PlanningImportResult
  ): Promise<void> {
    const existing = await this.library.listWorldEntries(projectPath);
    for (const item of (planningPackage.worldEntries ?? []).filter((entry) =>
      selection.worldEntries.includes(entry.id)
    )) {
      const parsed = WorldEntrySchema.parse(item);
      const conflict = findMatchingItem(existing, parsed, (entry) => entry.title);
      if (conflict && !shouldOverwrite(selection, "worldEntries", parsed.id)) {
        increment(result.skipped, "worldEntries");
        continue;
      }
      const next = conflict ? { ...parsed, id: conflict.id } : parsed;
      await this.library.saveWorldEntry(projectPath, next);
      replaceOrAppend(existing, next);
      increment(result.added, conflict ? "worldEntriesUpdated" : "worldEntries");
    }
  }

  private async importTimeline(
    projectPath: string,
    planningPackage: PlanningPackage,
    selection: PlanningImportSelection,
    result: PlanningImportResult
  ): Promise<void> {
    const existing = await this.story.listTimeline(projectPath);
    for (const item of (planningPackage.timeline ?? []).filter((entry) => selection.timeline.includes(entry.id))) {
      const parsed = TimelineEventSchema.parse(item);
      const conflict = findMatchingItem(existing, parsed, (entry) => entry.title);
      if (conflict && !shouldOverwrite(selection, "timeline", parsed.id)) {
        increment(result.skipped, "timeline");
        continue;
      }
      const next = conflict ? { ...parsed, id: conflict.id } : parsed;
      await this.story.saveTimelineEvent(projectPath, next);
      replaceOrAppend(existing, next);
      increment(result.added, conflict ? "timelineUpdated" : "timeline");
    }
  }

  private async importTerms(
    projectPath: string,
    planningPackage: PlanningPackage,
    selection: PlanningImportSelection,
    result: PlanningImportResult
  ): Promise<void> {
    const existing = await this.story.listTerms(projectPath);
    for (const item of (planningPackage.terms ?? []).filter((entry) => selection.terms.includes(entry.id))) {
      const parsed = TermSchema.parse(item);
      const conflict = findMatchingItem(existing, parsed, (entry) => entry.name);
      if (conflict && !shouldOverwrite(selection, "terms", parsed.id)) {
        increment(result.skipped, "terms");
        continue;
      }
      const next = conflict ? { ...parsed, id: conflict.id } : parsed;
      await this.story.saveTerm(projectPath, next);
      replaceOrAppend(existing, next);
      increment(result.added, conflict ? "termsUpdated" : "terms");
    }
  }

  private async importClues(
    projectPath: string,
    planningPackage: PlanningPackage,
    selection: PlanningImportSelection,
    result: PlanningImportResult
  ): Promise<void> {
    const existing = await this.story.listClues(projectPath);
    for (const item of (planningPackage.clues ?? []).filter((entry) => selection.clues.includes(entry.id))) {
      const parsed = ClueSchema.parse(item);
      const conflict = findMatchingItem(existing, parsed, (entry) => entry.title);
      if (conflict && !shouldOverwrite(selection, "clues", parsed.id)) {
        increment(result.skipped, "clues");
        continue;
      }
      const next = conflict ? { ...parsed, id: conflict.id } : parsed;
      await this.story.saveClue(projectPath, next);
      replaceOrAppend(existing, next);
      increment(result.added, conflict ? "cluesUpdated" : "clues");
    }
  }

  private async importOutline(
    projectPath: string,
    planningPackage: PlanningPackage,
    selection: PlanningImportSelection,
    result: PlanningImportResult
  ): Promise<void> {
    const project = await this.projects.openProject(projectPath);
    const selectedVolumes = (planningPackage.outline?.volumes ?? []).filter((volume) =>
      selection.outlineVolumeIds.includes(volume.id)
    );
    if (selectedVolumes.length === 0) {
      return;
    }

    let nextChapterNumber =
      Math.max(0, ...project.outline.volumes.flatMap((volume) => volume.chapters.map((chapter) => chapter.number))) + 1;
    let changed = false;
    const volumes: VolumePlan[] = [...project.outline.volumes];
    for (const volume of selectedVolumes) {
      const conflict = findMatchingItem(volumes, volume, (entry) => entry.title);
      if (conflict && !shouldOverwrite(selection, "outlineVolumeIds", volume.id)) {
        increment(result.skipped, "outline");
        continue;
      }
      if (conflict) {
        const volumeIndex = volumes.findIndex((entry) => entry.id === conflict.id);
        const volumeNumber = volumeIndex + 1;
        const retainedChapters = [...conflict.chapters];
        const chapters: ChapterPlan[] = volume.chapters.map((chapter) => {
          const existingIndex = retainedChapters.findIndex((entry) =>
            sameImportKey(entry, chapter, (item) => item.title)
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
          const next: ChapterPlan = {
            ...chapter,
            id: `ch-${String(number).padStart(4, "0")}`,
            number,
            file: chapterFile(volumeNumber, number),
            status: chapter.status ?? "planned"
          };
          return next;
        });
        for (const chapter of chapters.filter(
          (entry) => !conflict.chapters.some((existing) => existing.file === entry.file)
        )) {
          await this.files.writeTextAtomic(
            this.files.assertInsideProject(projectPath, chapter.file),
            `# ${chapter.title}\n\n`
          );
        }
        volumes[volumeIndex] = { ...volume, id: conflict.id, chapters: [...chapters, ...retainedChapters] };
        changed = true;
        increment(result.added, "outlineUpdated");
        continue;
      }
      const volumeNumber = volumes.length + 1;
      const chapters: ChapterPlan[] = volume.chapters.map((chapter) => {
        const number = nextChapterNumber++;
        return {
          ...chapter,
          id: `ch-${String(number).padStart(4, "0")}`,
          number,
          file: chapterFile(volumeNumber, number),
          status: chapter.status ?? "planned"
        };
      });
      for (const chapter of chapters) {
        await this.files.writeTextAtomic(
          this.files.assertInsideProject(projectPath, chapter.file),
          `# ${chapter.title}\n\n`
        );
      }
      volumes.push({ ...volume, id: `vol-${String(volumeNumber).padStart(3, "0")}`, chapters });
      changed = true;
      increment(result.added, "outline");
    }
    if (!changed) {
      return;
    }
    const outline: Outline = OutlineSchema.parse({
      ...project.outline,
      premise: planningPackage.outline.premise || project.outline.premise,
      mainConflict: planningPackage.outline.mainConflict || project.outline.mainConflict,
      endingDirection: planningPackage.outline.endingDirection || project.outline.endingDirection,
      volumes
    });
    await this.files.writeJsonAtomic(this.files.assertInsideProject(projectPath, "outline.json"), outline);
  }
}

const chapterFile = (volumeNumber: number, chapterNumber: number): string =>
  path.posix.join(
    "chapters",
    `volume-${String(volumeNumber).padStart(3, "0")}`,
    `ch-${String(chapterNumber).padStart(4, "0")}.md`
  );

const upsertById = <T extends { id: string }>(items: T[], item: T): T[] =>
  items.some((entry) => entry.id === item.id)
    ? items.map((entry) => (entry.id === item.id ? item : entry))
    : [item, ...items];

const increment = (target: Record<string, number>, key: string): void => {
  target[key] = (target[key] ?? 0) + 1;
};

type PlanningImportOverwriteKey = keyof NonNullable<PlanningImportSelection["overwrite"]>;

const normalizeKey = (value: string): string => value.trim().toLowerCase();

const sameImportKey = <T extends { id: string }>(existing: T, incoming: T, label: (item: T) => string): boolean =>
  existing.id === incoming.id || normalizeKey(label(existing)) === normalizeKey(label(incoming));

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

const planningSystemPrompt = (mode: "questions" | "package"): string => {
  if (mode === "questions") {
    return [
      "You are InkForge planning mode for long-form Chinese web novels.",
      "Ask 3-6 high-value clarifying questions before generating a plan.",
      "If existingCharacters / existingWorldEntries / existingTerms are provided, reference them rather than asking the author to redefine them.",
      "Keep questions concise and actionable. Do not output JSON in this mode."
    ].join("\n");
  }
  return [
    "You are InkForge planning mode. Output ONLY valid JSON.",
    "The JSON must match this structure: { meta, worldEntries, characters, timeline, terms, clues, outline }.",
    "If existingCharacters / existingWorldEntries / existingTerms are provided, avoid creating duplicate entries — instead reference existing ids or extend existing entries.",
    "Use stable lowercase ids. Put power systems in worldEntries with type power-system and levels in terms with category 境界.",
    `Every outline must include schemaVersion ${inkforgeSchemaVersion}.`
  ].join("\n");
};

const repairLlmJson = (raw: string): string => {
  const repaired = raw
    .replace(/,(\s*[}\]])/g, "$1")
    .replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, '$1"$2":')
    .replace(/'([^'\\]*)'/g, '"$1"');
  return repaired;
};

const stripJsonFence = (text: string): string => {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced?.[1] ?? text).trim();
};

const parseJsonFromText = (text: string): unknown => {
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

type PlanningProject = Awaited<ReturnType<ProjectService["openProject"]>>;

interface PlanningImportSnapshot {
  id: string;
  createdAt: string;
  outline: Outline;
  characters: Character[];
  worldEntries: WorldEntry[];
  timeline: TimelineEvent[];
  clues: Clue[];
  terms: Term[];
}

const normalizePlanningPackage = (project: PlanningProject, value: unknown): PlanningPackage => {
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

const normalizeOutline = (project: PlanningProject, value: unknown): Outline => {
  const item = asRecord(value);
  const volumes = Array.isArray(value)
    ? value.map(normalizeVolume)
    : firstArray(item.volumes, item.arcs).map(normalizeVolume);
  return OutlineSchema.parse({
    schemaVersion: inkforgeSchemaVersion,
    premise: text(item.premise) || project.outline.premise,
    mainConflict: text(item.mainConflict) || project.outline.mainConflict,
    endingDirection: text(item.endingDirection ?? item.ending) || project.outline.endingDirection,
    volumes
  });
};

const normalizeVolume = (value: unknown, index: number): VolumePlan => {
  const item = asRecord(value);
  const targetWords = Number(item.targetWords);
  return {
    id: nonEmptyText(item.id, fallbackId("vol", item.title ?? item.name ?? index + 1)),
    title: nonEmptyText(item.title ?? item.name, `Volume ${index + 1}`),
    goal: text(item.goal ?? item.summary),
    targetWords: Number.isFinite(targetWords) && targetWords > 0 ? targetWords : 90000,
    chapters: firstArray(item.chapters, item.chapterPlans).map(normalizeChapter)
  };
};

const chapterStatuses = new Set(["unplanned", "planned", "drafting", "revising", "done"]);

const normalizeChapter = (value: unknown, index: number): ChapterPlan => {
  const item = asRecord(value);
  const number = Number(item.number);
  const targetWords = Number(item.targetWords);
  const actualWords = Number(item.actualWords);
  const status = chapterStatuses.has(text(item.status)) ? text(item.status) : "planned";
  return {
    id: nonEmptyText(item.id, fallbackId("planning_ch", item.title ?? item.name ?? index + 1)),
    number: Number.isFinite(number) && number > 0 ? number : index + 1,
    title: nonEmptyText(item.title ?? item.name, `Chapter ${index + 1}`),
    file: text(item.file) || "planning.md",
    goal: text(item.goal ?? item.summary),
    hook: text(item.hook),
    status: status as ChapterPlan["status"],
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
      .split(/[,;，；、\n]/)
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

const formatPlanningError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};
