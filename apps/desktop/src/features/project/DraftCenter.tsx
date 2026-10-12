import { useEffect, useMemo, useState } from "react";
import { handleTabNavigation } from "@/lib/tabNavigation";
import { useEditorGuard } from "@/lib/useEditorGuard";
import { requestEditorLeave } from "@/lib/editorActions";
import { DailyWritingPanel } from "./DailyWritingPanel";
import { ManuscriptStockPanel } from "./ManuscriptStockPanel";
import "./writingManagement.css";
import {
  Archive,
  FileClock,
  FilePenLine,
  FileDiff,
  Lightbulb,
  Loader2,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Undo2
} from "lucide-react";
import type { ChapterPlan, InspirationFragment } from "@inkforge/schemas";
import type { ChapterHistoryEntry } from "@/types/app";
import { bridge } from "@/lib/browserBridge";
import { diffTextLines, summarizeDiff, type TextDiffLine } from "@/lib/textDiffLines";
import { countCjkAwareWords } from "@/lib/textMetrics";
import { mutateWritingWorkspace } from "@/lib/writingWorkspaceStore";
import { useProjectStore } from "@/stores/useProjectStore";

const statusLabels: Record<ChapterPlan["status"], string> = {
  unplanned: "未规划",
  planned: "已规划",
  drafting: "草稿中",
  revising: "修订中",
  done: "已完成"
};

type DraftTab = "chapters" | "history" | "fragments" | "daily" | "stock";

interface HistoryRow {
  file: string;
  title: string;
  entry: ChapterHistoryEntry;
}

export const DraftCenter = () => {
  const project = useProjectStore((state) => state.project);
  const current = useProjectStore((state) => state.current);
  const selectChapter = useProjectStore((state) => state.selectChapter);
  const setSelectedModule = useProjectStore((state) => state.setSelectedModule);
  const updateChapterPlan = useProjectStore((state) => state.updateChapterPlan);
  const batchUpdateChapterPlans = useProjectStore((state) => state.batchUpdateChapterPlans);
  const batchMoveChapters = useProjectStore((state) => state.batchMoveChapters);
  const createChapter = useProjectStore((state) => state.createChapter);
  const updateContent = useProjectStore((state) => state.updateContent);
  const saveCurrentChapter = useProjectStore((state) => state.saveCurrentChapter);
  const [tab, setTab] = useState<DraftTab>("chapters");
  const chooseTab = (next: DraftTab) => {
    if (next !== tab && requestEditorLeave()) {
      if (tab === "fragments") setFragmentDraft({ title: "", content: "", tags: "" });
      setTab(next);
    }
  };
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<ChapterPlan["status"] | "all" | "archived">("all");
  const [historyCounts, setHistoryCounts] = useState<Record<string, number>>({});
  const [historyRows, setHistoryRows] = useState<HistoryRow[]>([]);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchStatus, setBatchStatus] = useState<ChapterPlan["status"]>("drafting");
  const [batchVolume, setBatchVolume] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState<
    { row: HistoryRow; lines: TextDiffLine[]; added: number; removed: number } | undefined
  >();
  const [fragments, setFragments] = useState<InspirationFragment[]>([]);
  const [fragmentDraft, setFragmentDraft] = useState<{ id?: string; title: string; content: string; tags: string }>({
    title: "",
    content: "",
    tags: ""
  });

  const chapters = useMemo(
    () => project?.outline.volumes.flatMap((volume) => volume.chapters.map((chapter) => ({ chapter, volume }))) ?? [],
    [project]
  );
  const chapterByFile = useMemo(() => new Map(chapters.map(({ chapter }) => [chapter.file, chapter])), [chapters]);

  useEffect(() => {
    if (!project) return;
    setSelectedIds(new Set());
    const files = chapters.map(({ chapter }) => chapter.file);
    void bridge
      .listChapterHistoryOverview(project.projectPath, files)
      .then((overview) => {
        const counts: Record<string, number> = {};
        const rows: HistoryRow[] = [];
        for (const { chapter } of chapters) {
          const entries = overview[chapter.file] ?? [];
          counts[chapter.id] = entries.length;
          for (const entry of entries) {
            rows.push({ file: chapter.file, title: chapter.title, entry });
          }
        }
        rows.sort((left, right) => right.entry.createdAt.localeCompare(left.entry.createdAt));
        setHistoryCounts(counts);
        setHistoryRows(rows);
      })
      .catch(() => undefined);
  }, [project?.projectPath, project?.meta.updatedAt, chapters]);

  useEffect(() => {
    if (!project) return;
    void bridge
      .loadWritingWorkspace(project.projectPath)
      .then((workspace) => setFragments(workspace.fragments))
      .catch(() => undefined);
  }, [project?.projectPath, tab]);

  const visible = chapters.filter(({ chapter }) => {
    const matchesStatus =
      status === "all"
        ? !chapter.archived
        : status === "archived"
          ? chapter.archived
          : chapter.status === status && !chapter.archived;
    const needle = query.trim().toLocaleLowerCase("zh-CN");
    return (
      matchesStatus &&
      (!needle || `${chapter.title} ${chapter.goal} ${chapter.notes}`.toLocaleLowerCase("zh-CN").includes(needle))
    );
  });

  const toggleSelected = (chapterId: string) => {
    setSelectedIds((state) => {
      const next = new Set(state);
      if (next.has(chapterId)) {
        next.delete(chapterId);
      } else {
        next.add(chapterId);
      }
      return next;
    });
  };

  const runBatch = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      setSelectedIds(new Set());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "批量操作失败");
    } finally {
      setBusy(false);
    }
  };

  const open = async (chapter: ChapterPlan) => {
    await selectChapter(chapter);
  };

  const showHistoryPreview = async (row: HistoryRow) => {
    if (!project) return;
    setHistoryBusy(true);
    setError("");
    try {
      const [historyContent, currentContent] = await Promise.all([
        bridge.readChapterHistory(project.projectPath, row.file, row.entry.id),
        bridge.readChapter(project.projectPath, row.file)
      ]);
      const lines = diffTextLines(historyContent, currentContent);
      setPreview({ row, lines, ...summarizeDiff(lines) });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "读取历史版本失败");
    } finally {
      setHistoryBusy(false);
    }
  };

  const restoreHistory = async () => {
    if (!project || !preview) return;
    if (
      !window.confirm(
        `将「${preview.row.title}」恢复到 ${new Date(preview.row.entry.createdAt).toLocaleString("zh-CN")} 的版本？当前内容会先存入历史。`
      )
    ) {
      return;
    }
    setHistoryBusy(true);
    try {
      await bridge.restoreChapterHistory(project.projectPath, preview.row.file, preview.row.entry.id);
      const chapter = chapterByFile.get(preview.row.file);
      setPreview(undefined);
      if (chapter && current?.plan.id === chapter.id) {
        await selectChapter(chapter);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "恢复历史版本失败");
    } finally {
      setHistoryBusy(false);
    }
  };

  const saveFragment = async () => {
    if (!project || busy) return;
    const now = new Date().toISOString();
    const draft = fragmentDraft;
    if (!draft.content.trim() && !draft.title.trim()) return;
    const tags = draft.tags
      .split(/[,，]/u)
      .map((item) => item.trim())
      .filter(Boolean);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const workspace = await mutateWritingWorkspace(project.projectPath, (state) => {
        if (draft.id) {
          return {
            ...state,
            fragments: state.fragments.map((item) =>
              item.id === draft.id
                ? { ...item, title: draft.title.trim(), content: draft.content, tags, updatedAt: now }
                : item
            )
          };
        }
        return {
          ...state,
          fragments: [
            {
              id: `fragment-${Date.now()}`,
              title: draft.title.trim(),
              content: draft.content,
              tags,
              archived: false,
              createdAt: now,
              updatedAt: now
            },
            ...state.fragments
          ]
        };
      });
      setFragments(workspace.fragments);
      setFragmentDraft({ title: "", content: "", tags: "" });
      setNotice("灵感片段已保存。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存片段失败，内容仍保留在编辑框中。");
    } finally {
      setBusy(false);
    }
  };

  const mutateFragment = async (update: (fragments: InspirationFragment[]) => InspirationFragment[]) => {
    if (!project) return;
    await runBatch(async () => {
      const workspace = await mutateWritingWorkspace(project.projectPath, (state) => ({
        ...state,
        fragments: update(state.fragments)
      }));
      setFragments(workspace.fragments);
    });
  };

  const fragmentToChapter = async (fragment: InspirationFragment) => {
    if (!project) return;
    setError("");
    try {
      const previousChapterId = useProjectStore.getState().current?.plan.id;
      await createChapter();
      if (useProjectStore.getState().current?.plan.id === previousChapterId) return;
      setBusy(true);
      updateContent(fragment.content);
      await saveCurrentChapter();
      const created = useProjectStore.getState().current;
      if (created && fragment.title.trim()) {
        await updateChapterPlan(created.plan.id, { title: fragment.title.trim() });
      }
      setSelectedModule("chapters");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "从片段创建章节失败");
    } finally {
      setBusy(false);
    }
  };

  const totalWords = chapters.reduce((sum, item) => sum + item.chapter.actualWords, 0);
  const selectedCount = selectedIds.size;
  const originalFragment = fragments.find((item) => item.id === fragmentDraft.id);
  const fragmentDirty = originalFragment
    ? fragmentDraft.title !== originalFragment.title ||
      fragmentDraft.content !== originalFragment.content ||
      JSON.stringify(
        fragmentDraft.tags
          .split(/[,，]/u)
          .map((tag) => tag.trim())
          .filter(Boolean)
      ) !== JSON.stringify(originalFragment.tags)
    : Boolean(fragmentDraft.title.trim() || fragmentDraft.content.trim() || fragmentDraft.tags.trim());
  const canLeaveFragment = useEditorGuard(
    fragmentDirty,
    busy,
    tab === "fragments" ? () => void saveFragment() : undefined
  );

  useEffect(() => {
    setSelectedIds(new Set());
  }, [query, status]);

  return (
    <section className="library-screen draft-center">
      <header className="library-header">
        <div>
          <div className="crumb">写作</div>
          <h2>草稿与版本</h2>
          <p>管理每日写作计划、存稿发布记录、章节版本与灵感片段。</p>
        </div>
        <div className="draft-total">
          {chapters.length} 章 · {totalWords.toLocaleString("zh-CN")} 字
        </div>
      </header>

      <div className="draft-tabs" role="tablist" aria-label="草稿视图" onKeyDown={handleTabNavigation}>
        <button
          role="tab"
          aria-selected={tab === "chapters"}
          tabIndex={tab === "chapters" ? 0 : -1}
          className={tab === "chapters" ? "active" : ""}
          type="button"
          onClick={() => chooseTab("chapters")}
        >
          章节草稿
        </button>
        <button
          role="tab"
          aria-selected={tab === "history"}
          tabIndex={tab === "history" ? 0 : -1}
          className={tab === "history" ? "active" : ""}
          type="button"
          onClick={() => chooseTab("history")}
        >
          历史版本（{historyRows.length}）
        </button>
        <button
          role="tab"
          aria-selected={tab === "fragments"}
          tabIndex={tab === "fragments" ? 0 : -1}
          className={tab === "fragments" ? "active" : ""}
          type="button"
          onClick={() => chooseTab("fragments")}
        >
          灵感片段（{fragments.filter((item) => !item.archived).length}）
        </button>
        {(["daily", "stock"] as const).map((item) => (
          <button
            key={item}
            role="tab"
            aria-selected={tab === item}
            tabIndex={tab === item ? 0 : -1}
            className={tab === item ? "active" : ""}
            type="button"
            onClick={() => chooseTab(item)}
          >
            {item === "daily" ? "每日模板" : "存稿管理"}
          </button>
        ))}
      </div>

      {tab === "daily" && project ? <DailyWritingPanel key={project.projectPath} /> : null}
      {tab === "stock" && project ? <ManuscriptStockPanel key={project.projectPath} /> : null}

      {error ? (
        <div className="error-banner" role="alert">
          {error}
        </div>
      ) : null}

      {tab === "chapters" ? (
        <>
          <div className="draft-toolbar">
            <label>
              <Search size={15} />
              <input
                value={query}
                aria-label="搜索草稿"
                placeholder="搜索标题、目标或备注"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <select
              aria-label="按草稿状态筛选"
              value={status}
              onChange={(event) => setStatus(event.target.value as typeof status)}
            >
              <option value="all">全部进行中</option>
              {Object.entries(statusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
              <option value="archived">已归档</option>
            </select>
          </div>

          {selectedCount ? (
            <div className="draft-batch-bar">
              <strong>已选 {selectedCount} 章</strong>
              <button type="button" disabled={busy} onClick={() => setSelectedIds(new Set())}>
                取消选择
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void runBatch(() =>
                    batchUpdateChapterPlans(
                      [...selectedIds].map((chapterId) => ({ chapterId, patch: { archived: true } }))
                    )
                  )
                }
              >
                <Archive size={14} />
                批量归档
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void runBatch(() =>
                    batchUpdateChapterPlans(
                      [...selectedIds].map((chapterId) => ({ chapterId, patch: { archived: false } }))
                    )
                  )
                }
              >
                <Undo2 size={14} />
                移出归档
              </button>
              <label>
                状态
                <select
                  value={batchStatus}
                  onChange={(event) => setBatchStatus(event.target.value as ChapterPlan["status"])}
                >
                  {Object.entries(statusLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void runBatch(() =>
                      batchUpdateChapterPlans(
                        [...selectedIds].map((chapterId) => ({ chapterId, patch: { status: batchStatus } }))
                      )
                    )
                  }
                >
                  应用
                </button>
              </label>
              <label>
                移动到
                <select value={batchVolume} onChange={(event) => setBatchVolume(event.target.value)}>
                  <option value="">选择分卷…</option>
                  {project?.outline.volumes.map((volume) => (
                    <option key={volume.id} value={volume.id}>
                      {volume.title}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={busy || !batchVolume}
                  onClick={() => void runBatch(() => batchMoveChapters([...selectedIds], batchVolume))}
                >
                  移动
                </button>
              </label>
              {busy ? <Loader2 className="spinning" size={15} /> : null}
            </div>
          ) : null}

          <div className="draft-list">
            {visible.map(({ chapter, volume }) => (
              <article className={`draft-row ${chapter.id === current?.plan.id ? "active" : ""}`} key={chapter.id}>
                <input
                  type="checkbox"
                  disabled={busy}
                  aria-label={`选择 ${chapter.title}`}
                  checked={selectedIds.has(chapter.id)}
                  onChange={() => toggleSelected(chapter.id)}
                />
                <span className="draft-number">{String(chapter.number).padStart(2, "0")}</span>
                <div>
                  <strong>{chapter.title}</strong>
                  <small>
                    {volume.title} · {chapter.goal || "尚未填写章节目标"}
                  </small>
                </div>
                <span className={`draft-status ${chapter.status}`}>
                  {chapter.archived ? "已归档" : statusLabels[chapter.status]}
                </span>
                <span className="draft-words">
                  {chapter.actualWords.toLocaleString("zh-CN")} / {chapter.targetWords.toLocaleString("zh-CN")}
                </span>
                <span className="draft-history">
                  <FileClock size={14} />
                  {historyCounts[chapter.id] ?? 0}
                </span>
                <button type="button" disabled={busy} onClick={() => void open(chapter)}>
                  <FilePenLine size={15} />
                  编辑
                </button>
                <button
                  className="icon-button"
                  type="button"
                  title={chapter.archived ? "移出归档" : "归档章节"}
                  aria-label={chapter.archived ? "移出归档" : "归档章节"}
                  disabled={busy}
                  onClick={() => void runBatch(() => updateChapterPlan(chapter.id, { archived: !chapter.archived }))}
                >
                  {chapter.archived ? <Undo2 size={15} /> : <Archive size={15} />}
                </button>
              </article>
            ))}
            {!visible.length ? (
              <div className="module-empty-state">
                <Search size={24} />
                <strong>没有匹配的草稿</strong>
                <span>调整搜索词或状态筛选。</span>
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      {tab === "history" ? (
        <div className="draft-history-grid">
          <div className="draft-history-list">
            {historyRows.slice(0, 200).map((row) => (
              <button
                key={`${row.file}-${row.entry.id}`}
                type="button"
                className={preview?.row.entry.id === row.entry.id && preview.row.file === row.file ? "active" : ""}
                onClick={() => void showHistoryPreview(row)}
              >
                <strong>{row.title}</strong>
                <small>
                  {new Date(row.entry.createdAt).toLocaleString("zh-CN")} ·{" "}
                  {row.entry.size > 1024 ? `${(row.entry.size / 1024).toFixed(1)} KB` : `${row.entry.size} B`}
                </small>
              </button>
            ))}
            {!historyRows.length ? (
              <div className="module-empty-state">
                <FileClock size={24} />
                <strong>还没有历史版本</strong>
                <span>保存覆盖章节内容后会自动生成历史版本。</span>
              </div>
            ) : null}
          </div>
          <div className="draft-history-preview">
            {historyBusy ? (
              <p className="muted">
                <Loader2 className="spinning" size={14} /> 加载中…
              </p>
            ) : preview ? (
              <>
                <header>
                  <strong>
                    <FileDiff size={14} />
                    {preview.row.title} · 历史版本 → 当前版本
                  </strong>
                  <span className="muted">
                    +{preview.added} / -{preview.removed} 行
                  </span>
                </header>
                <pre>
                  {preview.lines
                    .filter((line, index, all) => {
                      if (line.kind !== "context") return true;
                      return all.slice(Math.max(0, index - 2), index + 3).some((item) => item.kind !== "context");
                    })
                    .slice(0, 400)
                    .map((line, index) => (
                      <span key={index} className={`diff-line diff-${line.kind}`}>
                        {line.kind === "add" ? "+ " : line.kind === "remove" ? "- " : "  "}
                        {line.text || " "}
                      </span>
                    ))}
                  {preview.added === 0 && preview.removed === 0 ? "该历史版本与当前内容一致。" : null}
                </pre>
                <button
                  className="secondary-button compact"
                  type="button"
                  disabled={historyBusy}
                  onClick={() => void restoreHistory()}
                >
                  <RotateCcw size={14} />
                  恢复此版本
                </button>
              </>
            ) : (
              <p className="muted">选择左侧的历史版本查看与当前内容的差异。</p>
            )}
          </div>
        </div>
      ) : null}

      {tab === "fragments" ? (
        <div className="fragment-grid">
          <div className="fragment-editor">
            <strong>
              <Lightbulb size={15} />
              {fragmentDraft.id ? "编辑片段" : "记录灵感"}
            </strong>
            <input
              placeholder="片段标题（可选）"
              aria-label="灵感片段标题"
              value={fragmentDraft.title}
              onChange={(event) => setFragmentDraft((draft) => ({ ...draft, title: event.target.value }))}
            />
            <textarea
              placeholder="灵感、桥段、对话草稿……这些内容独立于章节树保存。"
              aria-label="灵感片段内容"
              value={fragmentDraft.content}
              onChange={(event) => setFragmentDraft((draft) => ({ ...draft, content: event.target.value }))}
            />
            <input
              placeholder="标签，用逗号分隔（可选）"
              aria-label="灵感片段标签"
              value={fragmentDraft.tags}
              onChange={(event) => setFragmentDraft((draft) => ({ ...draft, tags: event.target.value }))}
            />
            <div className="inline-actions">
              <button
                className="primary-button compact"
                type="button"
                disabled={busy || (!fragmentDraft.content.trim() && !fragmentDraft.title.trim())}
                onClick={() => void saveFragment()}
              >
                <Plus size={14} />
                {fragmentDraft.id ? "保存修改" : "保存片段"}
              </button>
              {fragmentDraft.id ? (
                <button
                  className="secondary-button compact"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (canLeaveFragment()) setFragmentDraft({ title: "", content: "", tags: "" });
                  }}
                >
                  取消编辑
                </button>
              ) : null}
            </div>
            <span className="editor-feedback" role="status">
              {busy ? "正在保存…" : fragmentDirty ? "有未保存的修改 · Ctrl+S 保存片段" : notice}
            </span>
          </div>
          <div className="fragment-list">
            {fragments.map((fragment) => (
              <article key={fragment.id} className={fragment.archived ? "archived" : ""}>
                <header>
                  <strong>{fragment.title || "未命名片段"}</strong>
                  <small>
                    {countCjkAwareWords(fragment.content).toLocaleString("zh-CN")} 字 ·{" "}
                    {new Date(fragment.updatedAt).toLocaleString("zh-CN")}
                  </small>
                </header>
                {fragment.tags.length ? (
                  <div className="fragment-tags">
                    {fragment.tags.map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                  </div>
                ) : null}
                <p>{fragment.content.slice(0, 200) || "（空片段）"}</p>
                <footer>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (fragmentDraft.id !== fragment.id && canLeaveFragment())
                        setFragmentDraft({
                          id: fragment.id,
                          title: fragment.title,
                          content: fragment.content,
                          tags: fragment.tags.join(", ")
                        });
                    }}
                  >
                    编辑
                  </button>
                  <button type="button" disabled={busy} onClick={() => void fragmentToChapter(fragment)}>
                    转为章节
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void mutateFragment((items) =>
                        items.map((item) => (item.id === fragment.id ? { ...item, archived: !item.archived } : item))
                      )
                    }
                  >
                    {fragment.archived ? "取消归档" : "归档"}
                  </button>
                  <button
                    className="danger"
                    type="button"
                    aria-label={`删除片段 ${fragment.title || "未命名片段"}`}
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm("删除这个灵感片段？")) {
                        void mutateFragment((items) => items.filter((item) => item.id !== fragment.id));
                      }
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </footer>
              </article>
            ))}
            {!fragments.length ? (
              <div className="module-empty-state">
                <Lightbulb size={24} />
                <strong>还没有灵感片段</strong>
                <span>把不属于任何章节的灵感先存在这里，需要时一键转为章节。</span>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
};
