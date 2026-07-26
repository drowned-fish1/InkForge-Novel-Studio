import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CircleAlert,
  Download,
  FolderPlus,
  GripVertical,
  Info,
  Plus,
  Trash2,
  Waypoints
} from "lucide-react";
import {
  analyzeBeatBoard,
  flattenBeats,
  type Beat,
  type BeatBoard,
  type BeatType,
  type NarrativeAct,
  type NarrativeIssue,
  type TensionPoint
} from "@inkforge/schemas";
import { useNarrativeStore } from "@/stores/useNarrativeStore";
import { useProjectStore } from "@/stores/useProjectStore";

const beatTypeLabels: Record<BeatType, string> = {
  setup: "铺垫",
  inciting: "激励事件",
  rising: "推进",
  midpoint: "中点",
  climax: "高潮",
  resolution: "收束"
};

const severityIcons = {
  info: Info,
  warning: AlertTriangle,
  error: CircleAlert
} as const;

const createBeat = (): Beat => ({
  id: `beat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  title: "新节拍",
  type: "rising",
  summary: "",
  tension: 50,
  characters: [],
  choices: [],
  notes: ""
});

const createAct = (index: number): NarrativeAct => ({
  id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  title: `第${index}幕`,
  goal: "",
  beats: []
});

const removeBeatFromBoard = (board: BeatBoard, beatId: string): { board: BeatBoard; removed: Beat | null } => {
  let removed: Beat | null = null;
  const acts = board.acts.map((act) => {
    const beat = act.beats.find((item) => item.id === beatId);
    if (!beat) {
      return act;
    }
    removed = beat;
    return { ...act, beats: act.beats.filter((item) => item.id !== beatId) };
  });
  return { board: { ...board, acts }, removed };
};

const insertBeatIntoBoard = (board: BeatBoard, actId: string, beat: Beat, beforeBeatId?: string): BeatBoard => ({
  ...board,
  acts: board.acts.map((act) => {
    if (act.id !== actId) {
      return act;
    }
    const index = beforeBeatId ? act.beats.findIndex((item) => item.id === beforeBeatId) : -1;
    const beats = [...act.beats];
    beats.splice(index < 0 ? beats.length : index, 0, beat);
    return { ...act, beats };
  })
});

interface SparklineProps {
  points: TensionPoint[];
  actStarts: Set<number>;
}

const VIEW_WIDTH = 640;
const VIEW_HEIGHT = 150;
const PAD = { top: 12, right: 14, bottom: 22, left: 30 };

const TensionSparkline = ({ points, actStarts }: SparklineProps) => {
  const [hovered, setHovered] = useState<number | null>(null);
  const plotWidth = VIEW_WIDTH - PAD.left - PAD.right;
  const plotHeight = VIEW_HEIGHT - PAD.top - PAD.bottom;
  const x = (index: number): number =>
    points.length <= 1 ? PAD.left + plotWidth / 2 : PAD.left + (index / (points.length - 1)) * plotWidth;
  const y = (tension: number): number => PAD.top + (1 - tension / 100) * plotHeight;
  const line = points.map((point, index) => `${x(index)},${y(point.tension)}`).join(" ");
  const area = `${PAD.left},${y(0)} ${line} ${x(points.length - 1)},${y(0)}`;
  const hoveredPoint = hovered !== null ? points[hovered] : null;

  return (
    <div className="tension-sparkline" onMouseLeave={() => setHovered(null)}>
      <svg viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} role="img" aria-label="张力曲线">
        {[0, 50, 100].map((level) => (
          <g key={level}>
            <line className="sparkline-grid" x1={PAD.left} x2={VIEW_WIDTH - PAD.right} y1={y(level)} y2={y(level)} />
            <text className="sparkline-axis-label" x={PAD.left - 6} y={y(level) + 3} textAnchor="end">
              {level}
            </text>
          </g>
        ))}
        {points.map((point, index) =>
          index > 0 && actStarts.has(index) ? (
            <line
              key={`act-${point.beatId}`}
              className="sparkline-act-divider"
              x1={(x(index - 1) + x(index)) / 2}
              x2={(x(index - 1) + x(index)) / 2}
              y1={PAD.top}
              y2={VIEW_HEIGHT - PAD.bottom}
            />
          ) : null
        )}
        <polygon className="sparkline-area" points={area} />
        <polyline className="sparkline-line" points={line} />
        {points.map((point, index) => (
          <circle
            key={point.beatId}
            className={`sparkline-dot ${hovered === index ? "hovered" : ""}`}
            cx={x(index)}
            cy={y(point.tension)}
            r={hovered === index ? 5 : 3.5}
          />
        ))}
        {points.map((point, index) => (
          <rect
            key={`hit-${point.beatId}`}
            className="sparkline-hit"
            x={points.length <= 1 ? PAD.left : x(index) - plotWidth / Math.max(points.length - 1, 1) / 2}
            width={points.length <= 1 ? plotWidth : plotWidth / Math.max(points.length - 1, 1)}
            y={PAD.top}
            height={plotHeight}
            onMouseEnter={() => setHovered(index)}
          />
        ))}
      </svg>
      {hoveredPoint ? (
        <div className="sparkline-tooltip" style={{ left: `${(x(hoveredPoint.index) / VIEW_WIDTH) * 100}%` }}>
          <strong>{hoveredPoint.title}</strong>
          <span>
            {beatTypeLabels[hoveredPoint.type]} · 张力 {hoveredPoint.tension}
          </span>
        </div>
      ) : null}
    </div>
  );
};

export const NarrativeBoard = () => {
  const project = useProjectStore((state) => state.project);
  const board = useNarrativeStore((state) => state.board);
  const exporting = useNarrativeStore((state) => state.exporting);
  const lastExportPath = useNarrativeStore((state) => state.lastExportPath);
  const loadBoard = useNarrativeStore((state) => state.loadBoard);
  const updateBoard = useNarrativeStore((state) => state.updateBoard);
  const initThreeActs = useNarrativeStore((state) => state.initThreeActs);
  const importFromOutline = useNarrativeStore((state) => state.importFromOutline);
  const exportPlayable = useNarrativeStore((state) => state.exportPlayable);
  const [expandedBeatId, setExpandedBeatId] = useState<string | null>(null);
  const [draggedBeatId, setDraggedBeatId] = useState<string | null>(null);

  useEffect(() => {
    if (project) {
      void loadBoard();
    }
  }, [loadBoard, project?.projectPath]);

  const analysis = useMemo(() => (board ? analyzeBeatBoard(board) : null), [board]);
  const actStarts = useMemo(() => {
    const starts = new Set<number>();
    if (board) {
      let index = 0;
      for (const act of board.acts) {
        if (act.beats.length) {
          starts.add(index);
          index += act.beats.length;
        }
      }
    }
    return starts;
  }, [board]);
  const allBeats = useMemo(() => (board ? flattenBeats(board) : []), [board]);
  const chapters = useMemo(
    () => project?.outline.volumes.flatMap((volume) => volume.chapters.filter((chapter) => !chapter.archived)) ?? [],
    [project?.outline.volumes]
  );

  if (!project || !board) {
    return (
      <section className="outline-editor empty">
        <div>打开一个项目后即可使用叙事板。</div>
      </section>
    );
  }

  const mutate = (next: BeatBoard, flush = false) => updateBoard(next, { flush });

  const patchBeat = (beatId: string, patch: Partial<Beat>, flush = false) => {
    mutate(
      {
        ...board,
        acts: board.acts.map((act) => ({
          ...act,
          beats: act.beats.map((beat) => (beat.id === beatId ? { ...beat, ...patch } : beat))
        }))
      },
      flush
    );
  };

  const patchAct = (actId: string, patch: Partial<NarrativeAct>, flush = false) => {
    mutate({ ...board, acts: board.acts.map((act) => (act.id === actId ? { ...act, ...patch } : act)) }, flush);
  };

  const addBeat = (actId: string) => {
    const beat = createBeat();
    mutate(insertBeatIntoBoard(board, actId, beat), true);
    setExpandedBeatId(beat.id);
  };

  const deleteBeat = (beat: Beat) => {
    if (!window.confirm(`删除节拍「${beat.title}」？`)) {
      return;
    }
    const { board: next } = removeBeatFromBoard(board, beat.id);
    mutate(next, true);
  };

  const addAct = () => {
    mutate({ ...board, acts: [...board.acts, createAct(board.acts.length + 1)] }, true);
  };

  const deleteAct = (act: NarrativeAct) => {
    if (!window.confirm(`删除「${act.title}」及其中 ${act.beats.length} 个节拍？`)) {
      return;
    }
    mutate({ ...board, acts: board.acts.filter((item) => item.id !== act.id) }, true);
  };

  const dropBeat = (actId: string, beforeBeatId?: string, transferredBeatId?: string) => {
    const beatId = transferredBeatId || draggedBeatId;
    setDraggedBeatId(null);
    if (!beatId || beatId === beforeBeatId) {
      return;
    }
    const { board: without, removed } = removeBeatFromBoard(board, beatId);
    if (!removed) {
      return;
    }
    mutate(insertBeatIntoBoard(without, actId, removed, beforeBeatId), true);
  };

  const issues = analysis?.issues ?? [];

  return (
    <section className="outline-editor narrative-board-screen">
      <header className="outline-header">
        <div>
          <div className="crumb">剧情</div>
          <h2>叙事板</h2>
        </div>
        <div className="narrative-header-actions">
          <button
            className="secondary-button"
            type="button"
            disabled={exporting}
            onClick={() => void exportPlayable("twee")}
          >
            <Download size={15} />
            导出 Twee
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={exporting}
            onClick={() => void exportPlayable("ink")}
          >
            <Download size={15} />
            导出 ink
          </button>
          <button className="primary-button" type="button" onClick={addAct}>
            <FolderPlus size={15} />
            添加幕
          </button>
        </div>
      </header>

      {board.acts.length === 0 ? (
        <div className="narrative-empty">
          <Waypoints size={32} />
          <p>把故事拆成幕与节拍卡，实时查看张力曲线与节奏缺口。</p>
          <div className="narrative-header-actions">
            <button className="primary-button" type="button" onClick={initThreeActs}>
              初始化三幕结构
            </button>
            <button
              className="secondary-button"
              type="button"
              title="按卷生成幕、按章生成节拍卡"
              onClick={importFromOutline}
            >
              从大纲生成节拍
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="narrative-analysis">
            <div className="narrative-chart-card">
              <div className="narrative-chart-title">
                <span>张力曲线</span>
                {analysis && analysis.points.length ? (
                  <small>
                    {analysis.points.length} 个节拍 · 平均 {analysis.averageTension} · 峰值 {analysis.peakTension}
                  </small>
                ) : null}
              </div>
              {analysis && analysis.points.length >= 2 ? (
                <TensionSparkline points={analysis.points} actStarts={actStarts} />
              ) : (
                <div className="empty-list-hint">至少两个节拍后显示曲线。</div>
              )}
            </div>
            <div className="narrative-issues">
              <div className="narrative-chart-title">
                <span>结构诊断</span>
                {issues.length ? <small>{issues.length} 项</small> : null}
              </div>
              {issues.length ? (
                <ul>
                  {issues.map((issue: NarrativeIssue) => {
                    const Icon = severityIcons[issue.severity];
                    return (
                      <li key={issue.id} className={`narrative-issue ${issue.severity}`}>
                        <Icon size={14} />
                        <span>
                          <strong>{issue.title}</strong>
                          <small>{issue.detail}</small>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="empty-list-hint">没有发现结构问题。</div>
              )}
            </div>
          </div>
          {lastExportPath ? <div className="narrative-export-hint">已导出：{lastExportPath}</div> : null}

          <div className="kanban-board narrative-lanes">
            {board.acts.map((act) => (
              <div
                key={act.id}
                className="narrative-lane"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  dropBeat(act.id, undefined, event.dataTransfer.getData("text/plain"));
                }}
              >
                <div className="narrative-lane-header">
                  <input
                    aria-label="幕标题"
                    value={act.title}
                    onChange={(event) => patchAct(act.id, { title: event.target.value })}
                  />
                  <div className="inline-actions">
                    <button className="micro-button" type="button" title="添加节拍" onClick={() => addBeat(act.id)}>
                      <Plus size={13} />
                    </button>
                    <button className="micro-button" type="button" title="删除幕" onClick={() => deleteAct(act)}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
                <input
                  className="narrative-lane-goal"
                  aria-label="本幕目标"
                  placeholder="本幕目标"
                  value={act.goal}
                  onChange={(event) => patchAct(act.id, { goal: event.target.value })}
                />
                <div className="narrative-lane-beats">
                  {act.beats.map((beat) => (
                    <div
                      key={beat.id}
                      className={`narrative-beat-card ${expandedBeatId === beat.id ? "expanded" : ""} ${
                        beat.type === "climax" ? "climax" : ""
                      }`}
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.setData("text/plain", beat.id);
                        event.dataTransfer.effectAllowed = "move";
                        setDraggedBeatId(beat.id);
                      }}
                      onDragEnd={() => setDraggedBeatId(null)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        dropBeat(act.id, beat.id, event.dataTransfer.getData("text/plain"));
                      }}
                    >
                      <button
                        className="narrative-beat-summary-row"
                        type="button"
                        onClick={() => setExpandedBeatId(expandedBeatId === beat.id ? null : beat.id)}
                      >
                        <GripVertical size={13} className="drag-handle" />
                        <span className="narrative-beat-title">{beat.title}</span>
                        <small className="narrative-beat-meta">
                          {beatTypeLabels[beat.type]} · {beat.tension}
                        </small>
                      </button>
                      {expandedBeatId === beat.id ? (
                        <div className="narrative-beat-editor">
                          <label>
                            标题
                            <input
                              value={beat.title}
                              onChange={(event) => patchBeat(beat.id, { title: event.target.value })}
                            />
                          </label>
                          <div className="field-grid">
                            <label>
                              类型
                              <select
                                value={beat.type}
                                onChange={(event) => patchBeat(beat.id, { type: event.target.value as BeatType }, true)}
                              >
                                {Object.entries(beatTypeLabels).map(([value, label]) => (
                                  <option key={value} value={value}>
                                    {label}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label>
                              张力 {beat.tension}
                              <input
                                type="range"
                                min={0}
                                max={100}
                                value={beat.tension}
                                onChange={(event) => patchBeat(beat.id, { tension: Number(event.target.value) })}
                              />
                            </label>
                          </div>
                          <label>
                            概要
                            <textarea
                              rows={3}
                              value={beat.summary}
                              onChange={(event) => patchBeat(beat.id, { summary: event.target.value })}
                            />
                          </label>
                          <label>
                            关联章节
                            <select
                              value={beat.linkedChapterId ?? ""}
                              onChange={(event) =>
                                patchBeat(beat.id, { linkedChapterId: event.target.value || undefined }, true)
                              }
                            >
                              <option value="">未关联</option>
                              {chapters.map((chapter) => (
                                <option key={chapter.id} value={chapter.id}>
                                  {chapter.title}
                                </option>
                              ))}
                            </select>
                          </label>
                          <div className="narrative-choices">
                            <div className="narrative-chart-title">
                              <span>分支选项</span>
                              <button
                                className="tiny-text-button"
                                type="button"
                                onClick={() =>
                                  patchBeat(
                                    beat.id,
                                    {
                                      choices: [
                                        ...beat.choices,
                                        {
                                          id: `choice_${Date.now()}_${beat.choices.length}`,
                                          label: "新的选择",
                                          targetBeatId:
                                            allBeats.find(({ beat: item }) => item.id !== beat.id)?.beat.id ?? beat.id
                                        }
                                      ]
                                    },
                                    true
                                  )
                                }
                              >
                                添加分支
                              </button>
                            </div>
                            {beat.choices.map((choice) => (
                              <div className="narrative-choice-row" key={choice.id}>
                                <input
                                  aria-label="分支文案"
                                  value={choice.label}
                                  onChange={(event) =>
                                    patchBeat(beat.id, {
                                      choices: beat.choices.map((item) =>
                                        item.id === choice.id ? { ...item, label: event.target.value } : item
                                      )
                                    })
                                  }
                                />
                                <select
                                  aria-label="分支目标"
                                  value={choice.targetBeatId}
                                  onChange={(event) =>
                                    patchBeat(
                                      beat.id,
                                      {
                                        choices: beat.choices.map((item) =>
                                          item.id === choice.id ? { ...item, targetBeatId: event.target.value } : item
                                        )
                                      },
                                      true
                                    )
                                  }
                                >
                                  {allBeats.map(({ beat: target }) => (
                                    <option key={target.id} value={target.id}>
                                      {target.title}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  className="micro-button"
                                  type="button"
                                  title="删除分支"
                                  onClick={() =>
                                    patchBeat(
                                      beat.id,
                                      { choices: beat.choices.filter((item) => item.id !== choice.id) },
                                      true
                                    )
                                  }
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            ))}
                            {!beat.choices.length ? (
                              <div className="empty-list-hint">没有分支时按顺序线性推进。</div>
                            ) : null}
                          </div>
                          <button
                            className="secondary-button narrative-delete-beat"
                            type="button"
                            onClick={() => deleteBeat(beat)}
                          >
                            <Trash2 size={14} />
                            删除节拍
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ))}
                  {!act.beats.length ? <div className="empty-list-hint">拖入或新增节拍。</div> : null}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
};
