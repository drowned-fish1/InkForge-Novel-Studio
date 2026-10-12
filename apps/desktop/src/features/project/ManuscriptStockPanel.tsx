import { useMemo, useState } from "react";
import { Archive, FilePenLine } from "lucide-react";
import type { ChapterRelease } from "@inkforge/schemas";
import { dailyTemplates, localDayKey, manuscriptStock, releaseStatus } from "@/lib/dailyWriting";
import { useWritingWorkspace } from "@/lib/useWritingWorkspace";
import { useEditorGuard } from "@/lib/useEditorGuard";
import { useProjectStore } from "@/stores/useProjectStore";

const labels: Record<ChapterRelease["status"], string> = {
  draft: "未备稿",
  ready: "可发布存稿",
  scheduled: "已排期",
  published: "已发布"
};

export const ManuscriptStockPanel = () => {
  const project = useProjectStore((state) => state.project)!;
  const selectChapter = useProjectStore((state) => state.selectChapter);
  const { workspace, error, busy, mutate } = useWritingWorkspace(project.projectPath);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ChapterRelease["status"] | "all">("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [dates, setDates] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const chapters = useMemo(
    () =>
      project.outline.volumes.flatMap((volume) =>
        volume.chapters.filter((chapter) => !chapter.archived).map((chapter) => ({ chapter, volume: volume.title }))
      ),
    [project.outline]
  );
  const records = useMemo(
    () => new Map((workspace?.releases ?? []).map((record) => [record.chapterId, record])),
    [workspace?.releases]
  );
  const today = localDayKey();
  const plan = workspace?.dailyWriting?.plans.find((item) => item.date === today);
  const template =
    [...dailyTemplates, ...(workspace?.dailyWriting?.templates ?? [])].find(
      (item) => item.id === workspace?.dailyWriting?.activeTemplateId
    ) ?? dailyTemplates[0];
  const releaseWords = plan?.releaseWords ?? template.releaseWords;
  const stock = manuscriptStock(
    chapters.map((row) => row.chapter),
    workspace?.releases ?? [],
    releaseWords
  );
  const rows = chapters.filter(
    ({ chapter, volume }) =>
      (filter === "all" || releaseStatus(chapter, records.get(chapter.id)) === filter) &&
      `${volume} ${chapter.title}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  );

  const dirtyDateIds = Object.keys(dates).filter(
    (id) =>
      dates[id] !== (records.get(id)?.scheduledDate ?? records.get(id)?.publishedDate ?? today) &&
      chapters.some(({ chapter }) => chapter.id === id)
  );
  useEditorGuard(dirtyDateIds.length > 0, busy, () => void saveChangedDates());
  const saveChangedDates = async () => {
    const published = dirtyDateIds.filter((id) => records.get(id)?.status === "published");
    const scheduled = dirtyDateIds.filter((id) => !published.includes(id));
    if (published.length && !(await update(published, "published"))) return;
    if (scheduled.length) await update(scheduled, "scheduled");
  };

  const update = async (ids: string[], status: ChapterRelease["status"]) => {
    if (!workspace || busy) return;
    setActionError("");
    setNotice("");
    try {
      const targets = chapters.filter(({ chapter }) => ids.includes(chapter.id));
      if (!targets.length) return;
      if ((status === "scheduled" || status === "published") && targets.some(({ chapter }) => dates[chapter.id] === ""))
        throw new Error("请填写发布日期再保存记录。");
      if (status !== "draft" && targets.some(({ chapter }) => chapter.actualWords === 0))
        throw new Error("空章节不能标记为存稿或已发布，请先保存正文。");
      const now = new Date().toISOString();
      const updates = targets.map(
        ({ chapter }): ChapterRelease => ({
          chapterId: chapter.id,
          status,
          updatedAt: now,
          ...(status === "scheduled"
            ? { scheduledDate: dates[chapter.id] || records.get(chapter.id)?.scheduledDate || today }
            : {}),
          ...(status === "published"
            ? {
                publishedDate: dates[chapter.id] || records.get(chapter.id)?.publishedDate || today,
                publishedWords:
                  records.get(chapter.id)?.status === "published"
                    ? (records.get(chapter.id)?.publishedWords ?? chapter.actualWords)
                    : chapter.actualWords
              }
            : {})
        })
      );
      const idSet = new Set(updates.map((record) => record.chapterId));
      await mutate((state) => ({
        ...state,
        releases: [...(state.releases ?? []).filter((record) => !idSet.has(record.chapterId)), ...updates]
      }));
      setSelected([]);
      setDates((previous) => Object.fromEntries(Object.entries(previous).filter(([id]) => !idSet.has(id))));
      setNotice(`已将 ${updates.length} 章标记为「${labels[status]}」。`);
      return true;
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "更新存稿记录失败。");
      return false;
    }
  };

  if (!workspace) return <p role={error ? "alert" : "status"}>{error || "正在读取存稿记录…"}</p>;
  return (
    <div className="manuscript-stock-panel writing-management">
      <header className="writing-management-heading">
        <div>
          <h3>
            <Archive size={18} /> 存稿与连载记录
          </h3>
          <p>完成的非空章节默认计入存稿。按实际更新标记已发布，发布记录与草稿归档分别保存。</p>
        </div>
      </header>
      {error || actionError ? (
        <p className="error-banner" role="alert">
          {actionError || error}
        </p>
      ) : null}
      <div className="writing-management-metrics">
        <article>
          <small>可用存稿</small>
          <strong>{stock.chapters} 章</strong>
          <span>{stock.words.toLocaleString()} 字（含已排期）</span>
        </article>
        <article>
          <small>可支撑更新</small>
          <strong>{stock.days === undefined ? "未设日更量" : `${stock.days} 天`}</strong>
          <span>按每日 {releaseWords.toLocaleString()} 字估算</span>
        </article>
        <article>
          <small>已发布</small>
          <strong>{stock.published} 章</strong>
          <span>按本地发布记录统计</span>
        </article>
        <article>
          <small>待按期更新</small>
          <strong>{chapters.filter(({ chapter }) => records.get(chapter.id)?.status === "scheduled").length} 章</strong>
          <span>排期到期后手动标记已发布</span>
        </article>
      </div>
      <div className="stock-toolbar">
        <input
          aria-label="搜索存稿"
          placeholder="搜索分卷、章节名"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelected([]);
          }}
        />
        <select
          aria-label="存稿状态筛选"
          value={filter}
          onChange={(event) => {
            setFilter(event.target.value as typeof filter);
            setSelected([]);
          }}
        >
          <option value="all">全部章节</option>
          {Object.entries(labels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {selected.length ? (
        <div className="draft-batch-bar">
          <strong>已选 {selected.length} 章</strong>
          <button type="button" disabled={busy} onClick={() => void update(selected, "ready")}>
            标为存稿
          </button>
          <button type="button" disabled={busy} onClick={() => void update(selected, "published")}>
            标为已发布
          </button>
          <button type="button" disabled={busy} onClick={() => void update(selected, "draft")}>
            移出存稿／撤销发布
          </button>
          <button type="button" disabled={busy} onClick={() => setSelected([])}>
            取消选择
          </button>
        </div>
      ) : null}
      <div className="stock-list">
        {rows.map(({ chapter, volume }) => {
          const record = records.get(chapter.id);
          const status = releaseStatus(chapter, record);
          return (
            <article className="stock-row" key={chapter.id}>
              <input
                type="checkbox"
                aria-label={`选择存稿 ${chapter.title}`}
                disabled={busy}
                checked={selected.includes(chapter.id)}
                onChange={(event) =>
                  setSelected(
                    event.target.checked ? [...selected, chapter.id] : selected.filter((id) => id !== chapter.id)
                  )
                }
              />
              <div className="stock-chapter-title">
                <strong>{chapter.title}</strong>
                <small>
                  {volume} · {chapter.actualWords.toLocaleString()} 字
                </small>
                {record?.status === "published" ? (
                  <small>
                    发布于 {record.publishedDate} · 当时 {record.publishedWords?.toLocaleString() ?? "—"} 字
                    {record.publishedWords !== undefined && record.publishedWords !== chapter.actualWords
                      ? " · 发布后字数有变化"
                      : ""}
                  </small>
                ) : null}
              </div>
              <select
                aria-label={`${chapter.title}发布状态`}
                value={status}
                disabled={busy}
                onChange={(event) => void update([chapter.id], event.target.value as ChapterRelease["status"])}
              >
                {Object.entries(labels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <label className="stock-date">
                {status === "published" ? "实际发布日期" : "计划发布日期"}
                <input
                  type="date"
                  aria-label={`${chapter.title}发布日期`}
                  value={dates[chapter.id] ?? record?.scheduledDate ?? record?.publishedDate ?? today}
                  disabled={busy}
                  onChange={(event) => setDates({ ...dates, [chapter.id]: event.target.value })}
                />
              </label>
              <button
                type="button"
                className="secondary-button"
                disabled={busy || chapter.actualWords === 0}
                onClick={() => void update([chapter.id], status === "published" ? "published" : "scheduled")}
              >
                {status === "published" ? "更新记录" : "保存排期"}
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={`编辑存稿 ${chapter.title}`}
                disabled={busy}
                onClick={() => void selectChapter(chapter)}
              >
                <FilePenLine size={16} />
              </button>
              {status === "scheduled" ? (
                <small className="stock-schedule-note">
                  {record?.scheduledDate} {record?.scheduledDate && record.scheduledDate < today ? "· 已逾期" : ""}
                </small>
              ) : null}
            </article>
          );
        })}
        {!rows.length ? <p className="library-empty">没有符合条件的章节。</p> : null}
      </div>
      <p className="editor-feedback" role="status">
        {busy
          ? "正在保存发布记录…"
          : dirtyDateIds.length
            ? "日期有未保存的修改 · 保存排期／记录，或 Ctrl+S 批量保存"
            : notice}
      </p>
    </div>
  );
};
