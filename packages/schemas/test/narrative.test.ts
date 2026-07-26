import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  analyzeBeatBoard,
  BeatBoardSchema,
  boardFromOutline,
  compileBeatBoardToInk,
  compileBeatBoardToTwee,
  createThreeActBoard,
  flattenBeats,
  type Beat,
  type BeatBoard
} from "../src/narrative";

const beat = (id: string, overrides: Partial<Beat> = {}): Beat => ({
  id,
  title: `节拍 ${id}`,
  type: "rising",
  summary: "",
  tension: 50,
  characters: [],
  choices: [],
  notes: "",
  ...overrides
});

const board = (beats: Beat[][], actTitles?: string[]): BeatBoard =>
  BeatBoardSchema.parse({
    acts: beats.map((items, index) => ({
      id: `act-${index + 1}`,
      title: actTitles?.[index] ?? `第${index + 1}幕`,
      beats: items
    }))
  });

describe("BeatBoardSchema", () => {
  it("applies defaults", () => {
    const parsed = BeatBoardSchema.parse({
      acts: [{ id: "a", title: "开局", beats: [{ id: "b", title: "相遇" }] }]
    });
    expect(parsed.schemaVersion).toBe("0.1.0");
    expect(parsed.acts[0].beats[0].tension).toBe(50);
    expect(parsed.acts[0].beats[0].type).toBe("rising");
    expect(parsed.acts[0].beats[0].choices).toEqual([]);
  });

  it("rejects out-of-range tension", () => {
    expect(() =>
      BeatBoardSchema.parse({
        acts: [{ id: "a", title: "开局", beats: [{ id: "b", title: "相遇", tension: 120 }] }]
      })
    ).toThrow(ZodError);
  });

  it("creates a three act starter board", () => {
    const starter = createThreeActBoard();
    expect(starter.acts).toHaveLength(3);
    expect(starter.acts.every((act) => act.beats.length === 0)).toBe(true);
  });
});

describe("boardFromOutline", () => {
  const outline = {
    volumes: [
      {
        id: "v1",
        title: "第一卷",
        goal: "建立世界",
        chapters: [
          { id: "c1", title: "风起", goal: "介绍主角" },
          { id: "c2", title: "旧车票", goal: "抛出谜团" },
          { id: "c3", title: "对峙" }
        ]
      },
      {
        id: "v2",
        title: "第二卷",
        chapters: [
          { id: "c4", title: "摊牌" },
          { id: "c5", title: "尾声" },
          { id: "c6", title: "废案", archived: true }
        ]
      }
    ]
  };

  it("maps volumes to acts and active chapters to linked beats", () => {
    const board = boardFromOutline(outline);
    expect(board.acts.map((act) => act.title)).toEqual(["第一卷", "第二卷"]);
    expect(board.acts[0].beats.map((beat) => beat.linkedChapterId)).toEqual(["c1", "c2", "c3"]);
    expect(board.acts[1].beats.map((beat) => beat.title)).toEqual(["摊牌", "尾声"]);
    expect(board.acts[0].beats[0].summary).toBe("介绍主角");
  });

  it("assigns a default tension arc: setup, rising ramp, climax, resolution", () => {
    const board = boardFromOutline(outline);
    const beats = flattenBeats(board).map(({ beat }) => beat);
    expect(beats[0]).toMatchObject({ type: "setup", tension: 30 });
    expect(beats.at(-2)).toMatchObject({ type: "climax", tension: 90 });
    expect(beats.at(-1)).toMatchObject({ type: "resolution", tension: 40 });
    expect(beats[1].type).toBe("rising");
  });

  it("handles a single-chapter outline", () => {
    const board = boardFromOutline({
      volumes: [{ id: "v1", title: "第一卷", chapters: [{ id: "c1", title: "唯一一章" }] }]
    });
    expect(board.acts[0].beats).toHaveLength(1);
    expect(board.acts[0].beats[0]).toMatchObject({ type: "setup", tension: 50 });
  });
});

describe("flattenBeats", () => {
  it("keeps act order and assigns global indices", () => {
    const flat = flattenBeats(board([[beat("a1"), beat("a2")], [beat("b1")]]));
    expect(flat.map((item) => item.beat.id)).toEqual(["a1", "a2", "b1"]);
    expect(flat.map((item) => item.index)).toEqual([0, 1, 2]);
    expect(flat[2].act.id).toBe("act-2");
  });
});

describe("analyzeBeatBoard", () => {
  it("reports an empty board", () => {
    const analysis = analyzeBeatBoard(board([[]]));
    expect(analysis.issues.map((issue) => issue.id)).toContain("board-empty");
    expect(analysis.points).toEqual([]);
  });

  it("detects flat stretches", () => {
    const analysis = analyzeBeatBoard(
      board([
        [beat("a", { tension: 50 }), beat("b", { tension: 52 }), beat("c", { tension: 48 }), beat("d", { tension: 90 })]
      ])
    );
    const flat = analysis.issues.find((issue) => issue.id.startsWith("flat-"));
    expect(flat?.severity).toBe("warning");
    expect(flat?.beatId).toBe("a");
  });

  it("detects tension spikes in both directions", () => {
    const analysis = analyzeBeatBoard(
      board([[beat("a", { tension: 10 }), beat("b", { tension: 80 }), beat("c", { tension: 20 })]])
    );
    const spikes = analysis.issues.filter((issue) => issue.id.startsWith("spike-"));
    expect(spikes).toHaveLength(2);
    expect(spikes[0].title).toBe("张力骤升");
    expect(spikes[1].title).toBe("张力骤降");
  });

  it("flags missing structural beat types", () => {
    const analysis = analyzeBeatBoard(board([[beat("a"), beat("b", { tension: 70 }), beat("c", { tension: 30 })]]));
    const ids = analysis.issues.map((issue) => issue.id);
    expect(ids).toContain("missing-climax");
    expect(ids).toContain("missing-inciting");
    expect(ids).toContain("missing-resolution");
  });

  it("flags an early climax", () => {
    const analysis = analyzeBeatBoard(
      board([
        [
          beat("a", { type: "climax", tension: 90 }),
          beat("b", { tension: 60 }),
          beat("c", { tension: 55 }),
          beat("d", { tension: 52 })
        ]
      ])
    );
    expect(analysis.issues.some((issue) => issue.id === "early-climax")).toBe(true);
  });

  it("flags act imbalance", () => {
    const heavy = [
      beat("a1", { tension: 10 }),
      beat("a2", { tension: 30 }),
      beat("a3", { tension: 55 }),
      beat("a4", { tension: 70 }),
      beat("a5", { type: "climax", tension: 90 })
    ];
    const analysis = analyzeBeatBoard(board([heavy, [beat("b1", { type: "resolution", tension: 20 })]]));
    expect(analysis.issues.some((issue) => issue.id === "act-heavy-act-1")).toBe(true);
  });

  it("flags dangling choice targets as errors", () => {
    const analysis = analyzeBeatBoard(
      board([[beat("a", { choices: [{ id: "c1", label: "追上去", targetBeatId: "ghost" }] }), beat("b")]])
    );
    const dangling = analysis.issues.find((issue) => issue.id.startsWith("dangling-"));
    expect(dangling?.severity).toBe("error");
  });

  it("computes act balance and tension stats", () => {
    const analysis = analyzeBeatBoard(board([[beat("a", { tension: 40 })], [beat("b", { tension: 80 })]]));
    expect(analysis.actBalance.map((entry) => entry.share)).toEqual([0.5, 0.5]);
    expect(analysis.averageTension).toBe(60);
    expect(analysis.peakTension).toBe(80);
  });
});

describe("compileBeatBoardToTwee", () => {
  const sample = board([
    [
      beat("a", { title: "相遇", summary: "两人在车站相遇。", tension: 30 }),
      beat("b", {
        title: "抉择",
        tension: 60,
        choices: [
          { id: "c1", label: "坦白", targetBeatId: "c" },
          { id: "c2", label: "隐瞒", targetBeatId: "ghost" }
        ]
      })
    ],
    [beat("c", { title: "摊牌", type: "climax", tension: 90 })]
  ]);

  it("emits StoryTitle, StoryData and passages in order", () => {
    const twee = compileBeatBoardToTwee(sample, { title: "示例故事" });
    expect(twee).toContain(":: StoryTitle\n示例故事");
    expect(twee).toContain('"start": "相遇"');
    expect(twee.indexOf(":: 相遇")).toBeLessThan(twee.indexOf(":: 抉择"));
    expect(twee.indexOf(":: 抉择")).toBeLessThan(twee.indexOf(":: 摊牌"));
  });

  it("auto-links linear beats and renders choices", () => {
    const twee = compileBeatBoardToTwee(sample, { title: "示例故事" });
    expect(twee).toContain("[[继续->抉择]]");
    expect(twee).toContain("[[坦白->摊牌]]");
    expect(twee).toContain("[[隐瞒->未完成分支]]");
    expect(twee).toContain(":: 未完成分支");
  });

  it("is deterministic for the same input", () => {
    const first = compileBeatBoardToTwee(sample, { title: "示例故事" });
    const second = compileBeatBoardToTwee(sample, { title: "示例故事" });
    expect(first).toBe(second);
  });

  it("dedupes duplicate passage names", () => {
    const twee = compileBeatBoardToTwee(board([[beat("a", { title: "相遇" }), beat("b", { title: "相遇" })]]), {
      title: "重名"
    });
    expect(twee).toContain(":: 相遇 (2)");
    expect(twee).toContain("[[继续->相遇 (2)]]");
  });

  it("escapes twee markup inside text", () => {
    const twee = compileBeatBoardToTwee(board([[beat("a", { title: "开场", summary: "他说[[不要]]回头。" })]]), {
      title: "转义"
    });
    expect(twee).toContain("［［不要］］");
    expect(twee).not.toContain("[[不要]]");
  });

  it("removes link-arrow syntax from passage names and choice labels", () => {
    const twee = compileBeatBoardToTwee(
      board([
        [
          beat("a", {
            title: "对峙 -> 天台",
            choices: [{ id: "c1", label: "追上 -> 去", targetBeatId: "b" }]
          }),
          beat("b", { title: "收束" })
        ]
      ]),
      { title: "箭头转义" }
    );

    expect(twee).toContain(":: 对峙 → 天台");
    expect(twee).toContain("[[追上 → 去->收束]]");
    expect(twee).not.toContain("[[追上 -> 去->");
  });
});

describe("compileBeatBoardToInk", () => {
  const sample = board([
    [
      beat("a", { title: "相遇", summary: "两人在车站相遇。" }),
      beat("b", {
        title: "抉择",
        choices: [
          { id: "c1", label: "坦白", targetBeatId: "c" },
          { id: "c2", label: "隐瞒", targetBeatId: "ghost" }
        ]
      })
    ],
    [beat("c", { title: "摊牌" })]
  ]);

  it("diverts into the first knot and chains linear beats", () => {
    const ink = compileBeatBoardToInk(sample, { title: "示例故事" });
    expect(ink).toContain("-> beat_1");
    expect(ink).toContain("=== beat_1 ===");
    expect(ink.split("=== beat_1 ===")[1]).toContain("-> beat_2");
  });

  it("renders choices and routes dangling targets to the unfinished knot", () => {
    const ink = compileBeatBoardToInk(sample, { title: "示例故事" });
    expect(ink).toContain("+ [坦白] -> beat_3");
    expect(ink).toContain("+ [隐瞒] -> unfinished_branch");
    expect(ink).toContain("=== unfinished_branch ===");
  });

  it("ends the final beat with END", () => {
    const ink = compileBeatBoardToInk(sample, { title: "示例故事" });
    const lastKnot = ink.split("=== beat_3 ===")[1];
    expect(lastKnot).toContain("-> END");
  });

  it("sanitizes ink control sequences in prose", () => {
    const ink = compileBeatBoardToInk(board([[beat("a", { title: "开场", summary: "- 他转身 -> 离开" })]]), {
      title: "转义"
    });
    expect(ink).toContain("　- 他转身 → 离开");
  });

  it("sanitizes braces in prose and closing brackets in choice labels", () => {
    const ink = compileBeatBoardToInk(
      board([
        [
          beat("a", {
            title: "开场",
            summary: "他看见{秘密}",
            choices: [{ id: "c1", label: "[冒险] 翻窗", targetBeatId: "b" }]
          }),
          beat("b")
        ]
      ]),
      { title: "控制符转义" }
    );

    expect(ink).toContain("他看见｛秘密｝");
    expect(ink).toContain("+ [［冒险］ 翻窗] -> beat_2");
  });

  it("handles an empty board", () => {
    const ink = compileBeatBoardToInk(board([[]]), { title: "空板" });
    expect(ink).toContain("-> END");
  });
});
