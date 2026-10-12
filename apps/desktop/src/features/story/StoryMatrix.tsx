import { useEffect, useMemo, useState } from "react";
import { DataGrid, type Column } from "react-data-grid";
import "react-data-grid/lib/styles.css";
import { BookOpen, Download, RefreshCw } from "lucide-react";
import { bridge } from "@/lib/browserBridge";
import {
  buildStoryMatrix,
  matrixChapters,
  matrixCsv,
  matrixEvidenceLabels,
  type MatrixRow,
  type MatrixEvidence,
  type StoryMatrixInput,
  type StoryMatrixMode
} from "@/lib/storyMatrix";
import { handleTabNavigation } from "@/lib/tabNavigation";
import { useProjectStore } from "@/stores/useProjectStore";

const modes = [
  { id: "characters", label: "人物" },
  { id: "threads", label: "支线 / 伏笔" },
  { id: "pov", label: "视角" }
] as const;
type LoadedMatrix = Omit<StoryMatrixInput, "outline"> & { scope: string; warnings: string[] };

export const StoryMatrix = () => {
  const project = useProjectStore((state) => state.project);
  const selectChapter = useProjectStore((state) => state.selectChapter);
  const jumpToChapterOffset = useProjectStore((state) => state.jumpToChapterOffset);
  const setSelectedModule = useProjectStore((state) => state.setSelectedModule);
  const [mode, setMode] = useState<StoryMatrixMode>("characters");
  const [volumeId, setVolumeId] = useState("");
  const [query, setQuery] = useState("");
  const [onlyLinked, setOnlyLinked] = useState(false);
  const [includeMentions, setIncludeMentions] = useState(false);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<LoadedMatrix>();
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<{ rowId: string; chapterId: string }>();
  const chapters = useMemo(() => (project ? matrixChapters(project.outline) : []), [project?.outline]);
  const scope = JSON.stringify([
    project?.projectPath,
    chapters.map((chapter) => chapter.id),
    revision,
    includeMentions
  ]);
  const currentData = data?.scope === scope ? data : undefined;
  const busy = Boolean(project && !currentData && !error);

  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    setProgress(0);
    setError("");
    setSelected(undefined);
    const projectPath = project.projectPath;
    void (async () => {
      const [characters, clues, conflicts, timeline, threads] = await Promise.all([
        bridge.listCharacters(projectPath),
        bridge.listClues(projectPath),
        bridge.listConflicts(projectPath),
        bridge.listTimeline(projectPath),
        bridge.listStoryThreads(projectPath)
      ]);
      const scenes: StoryMatrixInput["scenes"] = {};
      const texts: Record<string, string> = {};
      const failedSceneChapterIds: string[] = [];
      const warnings: string[] = [];
      let cursor = 0;
      let completed = 0;
      await Promise.all(
        Array.from({ length: Math.min(8, chapters.length) }, async () => {
          while (!cancelled && cursor < chapters.length) {
            const chapter = chapters[cursor++];
            const [sceneResult, textResult] = await Promise.allSettled([
              bridge.listScenePlans(projectPath, chapter.id),
              includeMentions ? bridge.readChapter(projectPath, chapter.file) : Promise.resolve("")
            ]);
            if (sceneResult.status === "fulfilled") scenes[chapter.id] = sceneResult.value;
            else {
              failedSceneChapterIds.push(chapter.id);
              warnings.push(`${chapter.title}：场景读取失败`);
            }
            if (textResult.status === "fulfilled") texts[chapter.id] = textResult.value;
            else warnings.push(`${chapter.title}：正文读取失败，提及统计未包含本章`);
            completed += 1;
            if (!cancelled) setProgress(completed);
          }
        })
      );
      if (!cancelled)
        setData({
          scope,
          characters,
          clues,
          conflicts,
          timeline,
          threads,
          scenes,
          texts: includeMentions ? texts : undefined,
          failedSceneChapterIds,
          warnings
        });
    })().catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "矩阵读取失败，请刷新重试。");
    });
    return () => {
      cancelled = true;
    };
  }, [scope]);

  const visibleChapters = useMemo(
    () => chapters.filter((chapter) => !volumeId || chapter.volumeId === volumeId),
    [chapters, volumeId]
  );
  const matrixRows = useMemo(() => {
    if (!project || !currentData) return [];
    return buildStoryMatrix({ ...currentData, outline: project.outline }, mode);
  }, [currentData, project?.outline, mode]);
  const rows = useMemo(() => {
    return matrixRows.filter((row) => {
      return (
        (!query.trim() || `${row.title} ${row.subtitle}`.toLowerCase().includes(query.trim().toLowerCase())) &&
        (!onlyLinked || visibleChapters.some((chapter) => row.cells[chapter.id]?.length))
      );
    });
  }, [matrixRows, query, onlyLinked, visibleChapters]);
  const selectedRow = rows.find((row) => row.id === selected?.rowId);
  const selectedChapter = visibleChapters.find((chapter) => chapter.id === selected?.chapterId);
  const evidence = selectedChapter ? (selectedRow?.cells[selectedChapter.id] ?? []) : [];
  const columns = useMemo<Column<MatrixRow>[]>(
    () => [
      {
        key: "title",
        name: mode === "characters" ? "人物 / 整书覆盖" : mode === "pov" ? "视角 / 整书覆盖" : "剧情线 / 整书覆盖",
        frozen: true,
        width: 216,
        resizable: true,
        renderCell: ({ row }) => (
          <div className="matrix-row-label" title={row.subtitle}>
            <strong>{row.title}</strong>
            <small>
              {row.chapterCount} 章 · 最长间隔 {row.longestGap} 章
            </small>
          </div>
        )
      },
      ...visibleChapters.map(
        (chapter): Column<MatrixRow> => ({
          key: chapter.id,
          name: `${chapter.number}. ${chapter.title}`,
          width: 106,
          renderHeaderCell: () => (
            <span title={`${chapter.volumeTitle} · ${chapter.title}`}>
              {chapter.number}. {chapter.title}
            </span>
          ),
          renderCell: ({ row }) => {
            const cell = row.cells[chapter.id] ?? [];
            const kinds = [...new Set(cell.map((item) => item.kind))];
            return (
              <span
                className={`matrix-cell-mark ${kinds.length ? `matrix-kind-${kinds.find((kind) => kind !== "window") ?? "window"}` : "matrix-kind-empty"}`}
                title={cell.map((item) => item.detail).join("\n") || "无关联记录"}
              >
                {kinds.length ? kinds.map((kind) => matrixEvidenceLabels[kind]).join(" / ") : "—"}
              </span>
            );
          }
        })
      )
    ],
    [visibleChapters, mode]
  );

  if (!project) return null;
  const exportCsv = () => {
    const url = URL.createObjectURL(new Blob([matrixCsv(visibleChapters, rows)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${project.meta.title}-${modes.find((item) => item.id === mode)?.label.replace(/[/\\]/gu, "-")}-矩阵.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const openChapter = async (source?: MatrixEvidence) => {
    if (!selectedChapter) return;
    try {
      if (source?.offset === undefined) await selectChapter(selectedChapter);
      else
        await jumpToChapterOffset(
          selectedChapter,
          source.offset,
          source.offset + (source.selectionText?.length ?? 1),
          source.selectionText
        );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "打开章节失败。");
    }
  };
  return (
    <section className="story-matrix" aria-label="整书矩阵">
      <header className="matrix-heading">
        <div>
          <span className="crumb">整书结构</span>
          <h2>人物、支线与视角</h2>
          <p>按章节检查关联与空缺，点击格子查看来源。</p>
        </div>
        <div className="matrix-heading-actions">
          <button className="secondary-button compact" type="button" onClick={() => setRevision((value) => value + 1)}>
            <RefreshCw size={15} />
            刷新
          </button>
          <button
            className="secondary-button compact"
            type="button"
            disabled={busy || !rows.length}
            onClick={exportCsv}
          >
            <Download size={15} />
            导出 CSV
          </button>
        </div>
      </header>
      <div className="matrix-tabs" role="tablist" aria-label="矩阵类型" onKeyDown={handleTabNavigation}>
        {modes.map((item) => (
          <button
            key={item.id}
            type="button"
            id={`matrix-tab-${item.id}`}
            role="tab"
            aria-controls="matrix-panel"
            aria-selected={mode === item.id}
            tabIndex={mode === item.id ? 0 : -1}
            className={mode === item.id ? "active" : ""}
            onClick={() => {
              setMode(item.id);
              setSelected(undefined);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="matrix-toolbar">
        <label>
          章节范围
          <select
            value={volumeId}
            onChange={(event) => {
              setVolumeId(event.target.value);
              setSelected(undefined);
            }}
          >
            <option value="">整书 · {chapters.length} 章</option>
            {project.outline.volumes.map((volume) => (
              <option key={volume.id} value={volume.id}>
                {volume.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          筛选
          <input value={query} placeholder="搜索人物或剧情线" onChange={(event) => setQuery(event.target.value)} />
        </label>
        <label className="matrix-checkbox">
          <input type="checkbox" checked={onlyLinked} onChange={(event) => setOnlyLinked(event.target.checked)} />
          仅显示有关联的行
        </label>
        <label className="matrix-checkbox">
          <input
            type="checkbox"
            checked={includeMentions}
            onChange={(event) => setIncludeMentions(event.target.checked)}
          />
          扫描正文提及
        </label>
      </div>
      <p className="matrix-note">
        规划与场景来自现有记录；正文提及按姓名 /
        别名匹配，不代表人物出场。视角仅取已标注的场景。间隔按整书关联统计，预计回收不计入进展。
      </p>
      {busy ? (
        <p role="status">
          正在读取 {progress} / {chapters.length} 章…
        </p>
      ) : null}
      {error ? (
        <div className="error-banner compact" role="alert">
          {error}
        </div>
      ) : null}
      {currentData?.warnings.length ? (
        <div className="import-warning" role="status">
          {currentData.warnings.slice(0, 3).join("；")}
          {currentData.warnings.length > 3 ? `；共 ${currentData.warnings.length} 项读取失败` : ""}
        </div>
      ) : null}
      <div
        id="matrix-panel"
        role="tabpanel"
        aria-labelledby={`matrix-tab-${mode}`}
        aria-busy={busy}
        className="matrix-grid-wrap"
      >
        <DataGrid
          className="story-matrix-grid"
          aria-label={`${modes.find((item) => item.id === mode)?.label}章节矩阵`}
          columns={columns}
          rows={rows}
          rowKeyGetter={(row) => row.id}
          rowHeight={58}
          headerRowHeight={42}
          onCellClick={({ row, column }) => {
            if (column.key !== "title") setSelected({ rowId: row.id, chapterId: column.key });
          }}
          onCellKeyDown={(args, event) => {
            if (
              args.mode === "ACTIVE" &&
              args.row &&
              args.column &&
              (event.key === "Enter" || event.key === " ") &&
              args.column.key !== "title"
            ) {
              event.preventDefault();
              setSelected({ rowId: args.row.id, chapterId: args.column.key });
            }
          }}
          renderers={{
            noRowsFallback: (
              <div className="matrix-empty">
                {busy
                  ? "正在建立整书矩阵…"
                  : query || onlyLinked
                    ? "没有符合筛选条件的记录。"
                    : mode === "pov"
                      ? "暂无章节。"
                      : "暂无人物或剧情线记录。可先在人物、伏笔、冲突或续写工程中补充。"}
              </div>
            )
          }}
        />
      </div>
      <div className="matrix-legend">
        {Object.entries(matrixEvidenceLabels).map(([kind, label]) => (
          <span key={kind} className={`matrix-cell-mark matrix-kind-${kind}`}>
            {label}
          </span>
        ))}
      </div>
      {selectedRow && selectedChapter ? (
        <aside className="matrix-detail" aria-label="矩阵来源">
          <div className="matrix-detail-header">
            <strong>
              {selectedRow.title} · {selectedChapter.number}. {selectedChapter.title}
            </strong>
            <button className="secondary-button compact" type="button" onClick={() => void openChapter()}>
              <BookOpen size={15} />
              打开章节
            </button>
          </div>
          {evidence.length ? (
            <ul>
              {evidence.slice(0, 50).map((item, index) => (
                <li key={index}>
                  <span className={`matrix-cell-mark matrix-kind-${item.kind}`}>{matrixEvidenceLabels[item.kind]}</span>
                  <span>
                    {item.detail}
                    {item.excerpt ? <blockquote>{item.excerpt}</blockquote> : null}
                  </span>
                  {item.offset !== undefined ? (
                    <button type="button" className="tiny-text-button" onClick={() => void openChapter(item)}>
                      定位原文
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p>本章暂无关联记录；这不表示正文中一定没有出现。</p>
          )}
          {evidence.length > 50 ? <p>共 {evidence.length} 条来源，展示前 50 条。</p> : null}
          {mode === "pov" ? <p>打开章节后，在“场景规划”中选择视角人物。</p> : null}
        </aside>
      ) : null}
      {!busy && !rows.length && mode !== "pov" ? (
        <button
          className="secondary-button compact"
          type="button"
          onClick={() => setSelectedModule(mode === "characters" ? "characters" : "continuation")}
        >
          补充{mode === "characters" ? "人物" : "剧情线"}资料
        </button>
      ) : null}
    </section>
  );
};
