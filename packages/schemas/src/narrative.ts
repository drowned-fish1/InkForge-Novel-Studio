import { z } from "zod";

export const NarrativeSchemaVersion = "0.1.0";

export const BeatTypeSchema = z.enum(["setup", "inciting", "rising", "midpoint", "climax", "resolution"]);

export const BeatChoiceSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  targetBeatId: z.string().min(1)
});

export const BeatSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  type: BeatTypeSchema.default("rising"),
  summary: z.string().default(""),
  tension: z.number().int().min(0).max(100).default(50),
  linkedChapterId: z.string().optional(),
  linkedVolumeId: z.string().optional(),
  characters: z.array(z.string()).default([]),
  characterIds: z.array(z.string()).optional(),
  choices: z.array(BeatChoiceSchema).default([]),
  notes: z.string().default("")
});

export const NarrativeActSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  goal: z.string().default(""),
  beats: z.array(BeatSchema).default([])
});

export const BeatBoardSchema = z.object({
  schemaVersion: z.literal(NarrativeSchemaVersion).default(NarrativeSchemaVersion),
  acts: z.array(NarrativeActSchema).default([]),
  updatedAt: z.string().default("")
});

export type BeatType = z.infer<typeof BeatTypeSchema>;
export type BeatChoice = z.infer<typeof BeatChoiceSchema>;
export type Beat = z.infer<typeof BeatSchema>;
export type NarrativeAct = z.infer<typeof NarrativeActSchema>;
export type BeatBoard = z.infer<typeof BeatBoardSchema>;

export const createThreeActBoard = (): BeatBoard =>
  BeatBoardSchema.parse({
    acts: [
      { id: "act-1", title: "第一幕 · 建立", goal: "介绍主角与日常，埋下失衡的种子。", beats: [] },
      { id: "act-2", title: "第二幕 · 对抗", goal: "冲突升级，代价加重，直至最低谷。", beats: [] },
      { id: "act-3", title: "第三幕 · 解决", goal: "最终对决与新平衡。", beats: [] }
    ]
  });

interface OutlineChapterLike {
  id: string;
  title: string;
  goal?: string;
  archived?: boolean;
}

interface OutlineVolumeLike {
  id: string;
  title: string;
  goal?: string;
  chapters: OutlineChapterLike[];
}

// Deterministic seed board from an existing outline: one act per volume, one beat per
// active chapter, with a default tension arc (setup → rising ramp → climax → resolution).
export const boardFromOutline = (outline: { volumes: OutlineVolumeLike[] }): BeatBoard => {
  const chapters = outline.volumes.flatMap((volume) =>
    volume.chapters.filter((chapter) => !chapter.archived).map((chapter) => ({ volume, chapter }))
  );
  const total = chapters.length;
  const beatFor = (chapter: OutlineChapterLike, index: number): Beat => {
    let type: BeatType = "rising";
    let tension: number;
    if (total === 1) {
      type = "setup";
      tension = 50;
    } else if (index === 0) {
      type = "setup";
      tension = 30;
    } else if (index === total - 1) {
      type = "resolution";
      tension = 40;
    } else if (index === total - 2) {
      type = "climax";
      tension = 90;
    } else {
      tension = 40 + Math.round((35 * index) / Math.max(total - 3, 1));
    }
    return BeatSchema.parse({
      id: `beat-${chapter.id}`,
      title: chapter.title,
      type,
      tension,
      summary: chapter.goal ?? "",
      linkedChapterId: chapter.id
    });
  };
  return BeatBoardSchema.parse({
    acts: outline.volumes.map((volume) => ({
      id: `act-${volume.id}`,
      title: volume.title,
      goal: volume.goal ?? "",
      beats: chapters
        .map((entry, index) => ({ ...entry, index }))
        .filter((entry) => entry.volume.id === volume.id)
        .map((entry) => beatFor(entry.chapter, entry.index))
    }))
  });
};

export interface FlatBeat {
  beat: Beat;
  act: NarrativeAct;
  index: number;
}

export const flattenBeats = (board: BeatBoard): FlatBeat[] => {
  const flat: FlatBeat[] = [];
  for (const act of board.acts) {
    for (const beat of act.beats) {
      flat.push({ beat, act, index: flat.length });
    }
  }
  return flat;
};

export interface TensionPoint {
  beatId: string;
  actId: string;
  title: string;
  type: BeatType;
  tension: number;
  index: number;
}

export interface NarrativeIssue {
  id: string;
  severity: "info" | "warning" | "error";
  title: string;
  detail: string;
  beatId?: string;
  actId?: string;
}

export interface ActBalanceEntry {
  actId: string;
  title: string;
  beatCount: number;
  share: number;
}

export interface StructureAnalysis {
  points: TensionPoint[];
  issues: NarrativeIssue[];
  actBalance: ActBalanceEntry[];
  averageTension: number;
  peakTension: number;
}

const FLAT_STRETCH_LENGTH = 3;
const FLAT_STRETCH_RANGE = 8;
const SPIKE_DELTA = 45;

export const analyzeBeatBoard = (board: BeatBoard): StructureAnalysis => {
  const flat = flattenBeats(board);
  const points: TensionPoint[] = flat.map(({ beat, act, index }) => ({
    beatId: beat.id,
    actId: act.id,
    title: beat.title,
    type: beat.type,
    tension: beat.tension,
    index
  }));
  const issues: NarrativeIssue[] = [];
  const total = flat.length;

  const actBalance: ActBalanceEntry[] = board.acts.map((act) => ({
    actId: act.id,
    title: act.title,
    beatCount: act.beats.length,
    share: total > 0 ? act.beats.length / total : 0
  }));

  if (total === 0) {
    issues.push({
      id: "board-empty",
      severity: "info",
      title: "叙事板为空",
      detail: "还没有任何节拍卡。先添加节拍，再看张力曲线与节奏诊断。"
    });
    return { points, issues, actBalance, averageTension: 0, peakTension: 0 };
  }

  for (const act of board.acts) {
    if (act.beats.length === 0) {
      issues.push({
        id: `act-empty-${act.id}`,
        severity: "info",
        title: "空幕",
        detail: `「${act.title}」还没有节拍卡。`,
        actId: act.id
      });
    }
  }

  // Flat stretches: consecutive beats whose tension stays inside a narrow band.
  let stretchStart = 0;
  for (let i = 1; i <= points.length; i += 1) {
    const stretch = points.slice(stretchStart, i);
    const values = stretch.map((point) => point.tension);
    const withinBand = Math.max(...values) - Math.min(...values) <= FLAT_STRETCH_RANGE;
    if (i < points.length && withinBand) {
      continue;
    }
    const stretchEnd = withinBand ? i : i - 1;
    if (stretchEnd - stretchStart >= FLAT_STRETCH_LENGTH) {
      const first = points[stretchStart];
      const last = points[stretchEnd - 1];
      issues.push({
        id: `flat-${first.beatId}`,
        severity: "warning",
        title: "节奏平坦",
        detail: `「${first.title}」到「${last.title}」共 ${stretchEnd - stretchStart} 个节拍张力几乎没有变化，考虑插入转折或砍掉铺垫。`,
        beatId: first.beatId
      });
    }
    stretchStart = i - 1;
  }

  for (let i = 1; i < points.length; i += 1) {
    const delta = points[i].tension - points[i - 1].tension;
    if (Math.abs(delta) >= SPIKE_DELTA) {
      issues.push({
        id: `spike-${points[i].beatId}`,
        severity: "warning",
        title: delta > 0 ? "张力骤升" : "张力骤降",
        detail: `「${points[i - 1].title}」到「${points[i].title}」张力变化 ${delta > 0 ? "+" : ""}${delta}，确认是否需要过渡节拍。`,
        beatId: points[i].beatId
      });
    }
  }

  if (total >= 3) {
    if (!flat.some(({ beat }) => beat.type === "climax")) {
      issues.push({
        id: "missing-climax",
        severity: "warning",
        title: "缺少高潮节拍",
        detail: "整个叙事板没有标记为「高潮」的节拍。"
      });
    }
    if (!flat.some(({ beat }) => beat.type === "inciting")) {
      issues.push({
        id: "missing-inciting",
        severity: "info",
        title: "缺少激励事件",
        detail: "没有标记为「激励事件」的节拍，故事的失衡起点可能不清晰。"
      });
    }
    if (!flat.some(({ beat }) => beat.type === "resolution")) {
      issues.push({
        id: "missing-resolution",
        severity: "info",
        title: "缺少收束节拍",
        detail: "没有标记为「收束」的节拍，结尾可能悬空。"
      });
    }
  }

  if (total >= 4) {
    const climaxIndices = points.filter((point) => point.type === "climax").map((point) => point.index);
    const lastClimax = climaxIndices.at(-1);
    if (lastClimax !== undefined && lastClimax < Math.floor(total / 2)) {
      issues.push({
        id: "early-climax",
        severity: "warning",
        title: "高潮出现过早",
        detail: `高潮节拍位于第 ${lastClimax + 1}/${total} 位，后半段可能乏力。`,
        beatId: points[lastClimax].beatId
      });
    }
  }

  if (board.acts.length >= 2 && total >= 6) {
    for (const entry of actBalance) {
      if (entry.share > 0.6) {
        issues.push({
          id: `act-heavy-${entry.actId}`,
          severity: "warning",
          title: "幕间失衡",
          detail: `「${entry.title}」占了 ${Math.round(entry.share * 100)}% 的节拍，其余幕可能被挤压。`,
          actId: entry.actId
        });
      } else if (entry.share > 0 && entry.share < 0.1) {
        issues.push({
          id: `act-light-${entry.actId}`,
          severity: "info",
          title: "幕内节拍偏少",
          detail: `「${entry.title}」只占 ${Math.round(entry.share * 100)}% 的节拍。`,
          actId: entry.actId
        });
      }
    }
  }

  const beatIds = new Set(flat.map(({ beat }) => beat.id));
  for (const { beat } of flat) {
    for (const choice of beat.choices) {
      if (!beatIds.has(choice.targetBeatId)) {
        issues.push({
          id: `dangling-${beat.id}-${choice.id}`,
          severity: "error",
          title: "分支目标不存在",
          detail: `「${beat.title}」的分支「${choice.label}」指向不存在的节拍 ${choice.targetBeatId}。`,
          beatId: beat.id
        });
      }
    }
  }

  const tensions = points.map((point) => point.tension);
  return {
    points,
    issues,
    actBalance,
    averageTension: Math.round(tensions.reduce((sum, value) => sum + value, 0) / total),
    peakTension: Math.max(...tensions)
  };
};

export interface PlayableExportOptions {
  title: string;
  author?: string;
}

const UNFINISHED_PASSAGE = "未完成分支";
const UNFINISHED_KNOT = "unfinished_branch";

// Deterministic UUID-shaped IFID derived from the story title, so repeated
// exports of the same project produce identical twee files.
const deterministicIfid = (seed: string): string => {
  let hash = 0x811c9dc5;
  const hex: string[] = [];
  for (let round = 0; round < 4; round += 1) {
    for (let i = 0; i < seed.length; i += 1) {
      hash ^= seed.charCodeAt(i) + round;
      hash = Math.imul(hash, 0x01000193);
    }
    hex.push((hash >>> 0).toString(16).padStart(8, "0"));
  }
  const digest = hex.join("");
  return (
    `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-` +
    `a${digest.slice(17, 20)}-${digest.slice(20, 32)}`
  ).toUpperCase();
};

const sanitizeTweeText = (value: string): string =>
  value.replaceAll("[[", "［［").replaceAll("]]", "］］").replace(/^::/gmu, "　::");

const sanitizeTweeLinkComponent = (value: string): string => sanitizeTweeText(value).replace(/(?:->|<-)/gu, "→");

const tweePassageName = (title: string, index: number, used: Set<string>): string => {
  let base =
    title
      .replace(/[[\]{}|]/gu, " ")
      .replace(/(?:->|<-)/gu, "→")
      .replace(/\s+/gu, " ")
      .trim() || `节拍 ${index + 1}`;
  if (base === "StoryTitle" || base === "StoryData" || base === UNFINISHED_PASSAGE) {
    base = `${base} 节拍`;
  }
  let name = base;
  let attempt = 2;
  while (used.has(name)) {
    name = `${base} (${attempt})`;
    attempt += 1;
  }
  used.add(name);
  return name;
};

export const compileBeatBoardToTwee = (board: BeatBoard, options: PlayableExportOptions): string => {
  const flat = flattenBeats(board);
  const used = new Set<string>();
  const names = new Map<string, string>();
  for (const { beat, index } of flat) {
    names.set(beat.id, tweePassageName(beat.title, index, used));
  }

  const startName = flat.length ? names.get(flat[0].beat.id) : UNFINISHED_PASSAGE;
  let needsUnfinished = flat.length === 0;
  const sections: string[] = [
    `:: StoryTitle\n${sanitizeTweeText(options.title)}`,
    `:: StoryData\n${JSON.stringify(
      {
        ifid: deterministicIfid(options.title),
        format: "Harlowe",
        "format-version": "3.3.9",
        start: startName
      },
      null,
      2
    )}`
  ];

  for (const { beat, act, index } of flat) {
    const lines: string[] = [`:: ${names.get(beat.id)}`];
    lines.push(`''${sanitizeTweeText(act.title)}''`);
    if (beat.summary.trim()) {
      lines.push("", sanitizeTweeText(beat.summary.trim()));
    }
    const links: string[] = [];
    if (beat.choices.length) {
      for (const choice of beat.choices) {
        const target = names.get(choice.targetBeatId);
        if (target) {
          links.push(`[[${sanitizeTweeLinkComponent(choice.label)}->${target}]]`);
        } else {
          needsUnfinished = true;
          links.push(`[[${sanitizeTweeLinkComponent(choice.label)}->${UNFINISHED_PASSAGE}]]`);
        }
      }
    } else if (index < flat.length - 1) {
      links.push(`[[继续->${names.get(flat[index + 1].beat.id)}]]`);
    }
    if (links.length) {
      lines.push("", ...links);
    }
    sections.push(lines.join("\n"));
  }

  if (needsUnfinished) {
    sections.push(`:: ${UNFINISHED_PASSAGE}\n该分支尚未编写。`);
  }
  return `${sections.join("\n\n")}\n`;
};

const sanitizeInkText = (value: string): string =>
  value
    .replaceAll("->", "→")
    .replaceAll("{", "｛")
    .replaceAll("}", "｝")
    .replace(/^(\s*)([*+=~/-])/gmu, "$1　$2");

const sanitizeInkChoiceLabel = (value: string): string =>
  sanitizeInkText(value).replaceAll("[", "［").replaceAll("]", "］");

export const compileBeatBoardToInk = (board: BeatBoard, options: PlayableExportOptions): string => {
  const flat = flattenBeats(board);
  const names = new Map<string, string>();
  for (const { beat, index } of flat) {
    names.set(beat.id, `beat_${index + 1}`);
  }

  const lines: string[] = [`// ${options.title}`];
  if (!flat.length) {
    lines.push("该叙事板还没有节拍。", "-> END");
    return `${lines.join("\n")}\n`;
  }

  lines.push(`-> ${names.get(flat[0].beat.id)}`);
  let needsUnfinished = false;
  for (const { beat, act, index } of flat) {
    lines.push("", `=== ${names.get(beat.id)} ===`, `// ${act.title} · ${beat.title}`);
    lines.push(sanitizeInkText(beat.title));
    if (beat.summary.trim()) {
      lines.push(sanitizeInkText(beat.summary.trim()));
    }
    if (beat.choices.length) {
      for (const choice of beat.choices) {
        const target = names.get(choice.targetBeatId);
        if (!target) {
          needsUnfinished = true;
        }
        lines.push(`+ [${sanitizeInkChoiceLabel(choice.label)}] -> ${target ?? UNFINISHED_KNOT}`);
      }
    } else if (index < flat.length - 1) {
      lines.push(`-> ${names.get(flat[index + 1].beat.id)}`);
    } else {
      lines.push("-> END");
    }
  }

  if (needsUnfinished) {
    lines.push("", `=== ${UNFINISHED_KNOT} ===`, "该分支尚未编写。", "-> END");
  }
  return `${lines.join("\n")}\n`;
};
