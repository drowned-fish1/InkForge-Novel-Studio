import type {
  Character,
  ChapterPlan,
  Clue,
  Conflict,
  Outline,
  ScenePlan,
  StoryThread,
  TimelineEvent
} from "@inkforge/schemas";

export type StoryMatrixMode = "characters" | "threads" | "pov";
export type MatrixEvidenceKind =
  | "plan"
  | "scene"
  | "event"
  | "mention"
  | "setup"
  | "progress"
  | "payoff"
  | "window"
  | "unknown";
export interface MatrixEvidence {
  kind: MatrixEvidenceKind;
  detail: string;
  sceneId?: string;
  excerpt?: string;
  offset?: number;
  selectionText?: string;
}
export interface MatrixRow {
  id: string;
  title: string;
  subtitle: string;
  cells: Record<string, MatrixEvidence[]>;
  chapterCount: number;
  longestGap: number;
}
export interface MatrixChapter extends ChapterPlan {
  volumeId: string;
  volumeTitle: string;
}
export interface StoryMatrixInput {
  outline: Outline;
  characters: Character[];
  clues: Clue[];
  conflicts: Conflict[];
  timeline: TimelineEvent[];
  threads: StoryThread[];
  scenes: Record<string, ScenePlan[]>;
  texts?: Record<string, string>;
  failedSceneChapterIds?: string[];
}
export const matrixEvidenceLabels: Record<MatrixEvidenceKind, string> = {
  plan: "规划",
  scene: "场景",
  event: "事件",
  mention: "提及",
  setup: "铺垫",
  progress: "推进",
  payoff: "回收",
  window: "预计",
  unknown: "待补"
};
const statusLabels: Record<string, string> = {
  candidate: "待确认",
  planned: "已规划",
  planted: "已埋设",
  developed: "已发展",
  active: "进行中",
  progressing: "推进中",
  due: "待回收",
  escalating: "升级中",
  resolved: "已解决",
  abandoned: "已放弃"
};

export const matrixChapters = (outline: Outline): MatrixChapter[] =>
  outline.volumes.flatMap((volume) =>
    volume.chapters
      .filter((chapter) => !chapter.archived)
      .map((chapter) => ({ ...chapter, volumeId: volume.id, volumeTitle: volume.title }))
  );

const rowOf = (id: string, title: string, subtitle = ""): MatrixRow => ({
  id,
  title,
  subtitle,
  cells: {},
  chapterCount: 0,
  longestGap: 0
});
const add = (row: MatrixRow | undefined, chapterId: string, evidence: MatrixEvidence, valid: Set<string>) => {
  if (!row || !valid.has(chapterId)) return;
  const cell = row.cells[chapterId] ?? (row.cells[chapterId] = []);
  if (
    !cell.some(
      (item) =>
        item.kind === evidence.kind &&
        item.detail === evidence.detail &&
        item.sceneId === evidence.sceneId &&
        item.offset === evidence.offset &&
        item.excerpt === evidence.excerpt
    )
  )
    cell.push(evidence);
};

export const buildStoryMatrix = (input: StoryMatrixInput, mode: StoryMatrixMode): MatrixRow[] => {
  const chapters = matrixChapters(input.outline);
  const valid = new Set(chapters.map((chapter) => chapter.id));
  let rows: MatrixRow[];
  if (mode === "threads") {
    rows = [];
    const migratedClues = new Set(
      input.threads.flatMap((thread) => (thread.legacyClueId ? [thread.legacyClueId] : []))
    );
    for (const thread of input.threads) {
      const row = rowOf(`thread:${thread.id}`, thread.title, `剧情线 · ${statusLabels[thread.status]}`);
      for (const [refs, kind] of [
        [thread.setupRefs, "setup"],
        [thread.progressRefs, "progress"],
        [thread.payoffRefs, "payoff"]
      ] as const) {
        for (const ref of refs)
          add(
            row,
            ref.chapterId,
            {
              kind,
              detail: matrixEvidenceLabels[kind],
              sceneId: ref.sceneId,
              excerpt: ref.excerpt,
              offset: ref.startOffset,
              selectionText: ref.excerpt
            },
            valid
          );
      }
      if (thread.status !== "resolved" && thread.status !== "abandoned")
        for (const chapter of chapters) {
          if (thread.earliestPayoffChapter === undefined && thread.latestPayoffChapter === undefined) continue;
          if (
            chapter.number >= (thread.earliestPayoffChapter ?? thread.latestPayoffChapter ?? Infinity) &&
            chapter.number <= (thread.latestPayoffChapter ?? thread.earliestPayoffChapter ?? -Infinity)
          )
            add(row, chapter.id, { kind: "window", detail: `预计回收：${thread.expectedPayoff || "尚未填写"}` }, valid);
        }
      rows.push(row);
    }
    for (const clue of input.clues) {
      if (migratedClues.has(clue.id)) continue;
      const row = rowOf(`clue:${clue.id}`, clue.title, `伏笔 · ${statusLabels[clue.status]}`);
      if (clue.plantedChapterId)
        add(
          row,
          clue.plantedChapterId,
          { kind: clue.status === "planned" ? "plan" : "setup", detail: `伏笔埋设 · ${statusLabels[clue.status]}` },
          valid
        );
      for (const [chapterId, scenes] of Object.entries(input.scenes))
        for (const scene of scenes)
          if (scene.clueRefs.includes(clue.id) || scene.clueRefs.includes(clue.title))
            add(row, chapterId, { kind: "scene", detail: `场景关联：${scene.title}`, sceneId: scene.id }, valid);
      rows.push(row);
    }
    for (const conflict of input.conflicts) {
      const row = rowOf(
        `conflict:${conflict.id}`,
        conflict.title,
        `${conflict.kind === "main" ? "主线" : "支线"}冲突 · ${statusLabels[conflict.status]}`
      );
      for (const chapterId of conflict.chapterIds)
        add(row, chapterId, { kind: "plan", detail: `冲突关联 · ${statusLabels[conflict.status]}` }, valid);
      rows.push(row);
    }
  } else {
    rows = input.characters.map((character) => rowOf(character.id, character.name));
    const byId = new Map(rows.map((row) => [row.id, row]));
    const byName = new Map<string, Set<string>>();
    for (const character of input.characters)
      for (const name of [character.name, ...character.aliases]) {
        const key = name.trim().toLowerCase();
        if (!key) continue;
        const ids = byName.get(key) ?? new Set<string>();
        ids.add(character.id);
        byName.set(key, ids);
      }
    const resolve = (value: string): MatrixRow | undefined => {
      if (byId.has(value)) return byId.get(value);
      const ids = byName.get(value.trim().toLowerCase());
      return ids?.size === 1 ? byId.get([...ids][0]) : undefined;
    };
    const matchers =
      mode === "characters" && input.texts
        ? input.characters.flatMap((character) => {
            const names = [
              ...new Set(
                [character.name, ...character.aliases]
                  .map((name) => name.trim())
                  .filter((name) => name && byName.get(name.toLowerCase())?.size === 1)
              )
            ].sort((a, b) => b.length - a.length);
            if (!names.length) return [];
            const pattern = names
              .map((name) => {
                const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
                return /^[a-z\d _'-]+$/iu.test(name) ? `(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])` : escaped;
              })
              .join("|");
            return [{ id: character.id, regex: new RegExp(pattern, "giu") }];
          })
        : [];
    const unknown = rowOf("__unassigned_pov__", "未标注 / 引用失效", "在章节的场景规划中补全视角");
    for (const chapter of chapters) {
      if (mode === "characters") {
        for (const character of chapter.characterIds ?? chapter.characters)
          add(resolve(character), chapter.id, { kind: "plan", detail: "章节人物规划" }, valid);
        for (const event of input.timeline)
          if (event.chapterId === chapter.id)
            for (const participant of event.participantIds ?? event.participants)
              add(resolve(participant), chapter.id, { kind: "event", detail: `时间线：${event.title}` }, valid);
        const text = input.texts?.[chapter.id];
        if (text)
          for (const matcher of matchers) {
            const first = matcher.regex.exec(text);
            let count = first ? 1 : 0;
            if (first) while (matcher.regex.exec(text)) count += 1;
            if (first) {
              const offset = first.index;
              add(
                byId.get(matcher.id),
                chapter.id,
                {
                  kind: "mention",
                  detail: `正文提及 ${count} 次（不等于出场）`,
                  offset,
                  selectionText: first[0],
                  excerpt: text.slice(Math.max(0, offset - 30), offset + 90)
                },
                valid
              );
            }
          }
      }
      const scenes = input.scenes[chapter.id] ?? [];
      if (mode === "pov" && !scenes.length)
        add(
          unknown,
          chapter.id,
          {
            kind: "unknown",
            detail: input.failedSceneChapterIds?.includes(chapter.id) ? "场景读取失败，刷新后重试" : "没有场景视角记录"
          },
          valid
        );
      for (const scene of scenes) {
        const pov = scene.povCharacterId ? resolve(scene.povCharacterId) : undefined;
        add(
          mode === "pov" ? (pov ?? unknown) : pov,
          chapter.id,
          {
            kind: pov ? "scene" : "unknown",
            detail: `${scene.title} · ${pov ? "视角" : scene.povCharacterId ? `失效视角 ${scene.povCharacterId}` : "未标注视角"}`,
            sceneId: scene.id
          },
          valid
        );
        if (mode === "characters")
          for (const character of scene.requiredCharacters)
            add(
              resolve(character),
              chapter.id,
              { kind: "scene", detail: `场景人物：${scene.title}`, sceneId: scene.id },
              valid
            );
      }
    }
    if (mode === "pov") rows.push(unknown);
  }
  for (const row of rows) {
    // Expected payoff windows are plans, not actual thread progress.
    const indices = chapters.flatMap((chapter, index) =>
      row.cells[chapter.id]?.some((evidence) => evidence.kind !== "window") ? [index] : []
    );
    row.chapterCount = indices.length;
    if (indices.length)
      row.longestGap = Math.max(
        chapters.length - 1 - indices.at(-1)!,
        ...indices.slice(1).map((index, i) => index - indices[i] - 1)
      );
  }
  return rows;
};

export const matrixCsv = (chapters: MatrixChapter[], rows: MatrixRow[]): string => {
  const quote = (value: string) =>
    `"${(/^\s*[=+\-@]/u.test(value) || /^[\t\r]/u.test(value) ? "'" : "") + value.replace(/"/gu, '""')}"`;
  return (
    "\uFEFF" +
    [
      [
        "人物 / 剧情线 / 视角",
        ...chapters.map((chapter) => `${chapter.volumeTitle} · ${chapter.number}. ${chapter.title}`)
      ],
      ...rows.map((row) => [
        row.title,
        ...chapters.map((chapter) =>
          [...new Set((row.cells[chapter.id] ?? []).map((evidence) => matrixEvidenceLabels[evidence.kind]))].join(" / ")
        )
      ])
    ]
      .map((line) => line.map(quote).join(","))
      .join("\r\n")
  );
};
