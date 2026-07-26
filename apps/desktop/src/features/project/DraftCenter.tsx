import { useEffect, useMemo, useState } from "react";
import { Archive, FileClock, FilePenLine, Search, Undo2 } from "lucide-react";
import type { ChapterPlan } from "@inkforge/schemas";
import { bridge } from "@/lib/browserBridge";
import { useProjectStore } from "@/stores/useProjectStore";

const statusLabels: Record<ChapterPlan["status"], string> = {
  unplanned: "未规划",
  planned: "已规划",
  drafting: "草稿中",
  revising: "修订中",
  done: "已完成"
};

export const DraftCenter = () => {
  const project = useProjectStore((state) => state.project);
  const current = useProjectStore((state) => state.current);
  const selectChapter = useProjectStore((state) => state.selectChapter);
  const setSelectedModule = useProjectStore((state) => state.setSelectedModule);
  const updateChapterPlan = useProjectStore((state) => state.updateChapterPlan);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<ChapterPlan["status"] | "all">("all");
  const [historyCounts, setHistoryCounts] = useState<Record<string, number>>({});

  const chapters = useMemo(
    () => project?.outline.volumes.flatMap((volume) => volume.chapters.map((chapter) => ({ chapter, volume }))) ?? [],
    [project]
  );

  useEffect(() => {
    if (!project) return;
    void Promise.all(
      chapters.map(
        async ({ chapter }) =>
          [chapter.id, (await bridge.listChapterHistory(project.projectPath, chapter.file)).length] as const
      )
    ).then((entries) => setHistoryCounts(Object.fromEntries(entries)));
  }, [project?.projectPath, project?.meta.updatedAt]);

  const visible = chapters.filter(({ chapter }) => {
    const matchesStatus = status === "all" || chapter.status === status;
    const needle = query.trim().toLocaleLowerCase("zh-CN");
    return (
      matchesStatus &&
      (!needle || `${chapter.title} ${chapter.goal} ${chapter.notes}`.toLocaleLowerCase("zh-CN").includes(needle))
    );
  });

  const open = async (chapter: ChapterPlan) => {
    await selectChapter(chapter);
    setSelectedModule("chapters");
  };

  return (
    <section className="library-screen draft-center">
      <header className="library-header">
        <div>
          <div className="crumb">写作</div>
          <h2>草稿与版本</h2>
          <p>按写作状态集中查看章节，并从任意草稿进入正文或历史版本。</p>
        </div>
        <div className="draft-total">
          {chapters.length} 章 ·{" "}
          {chapters.reduce((sum, item) => sum + item.chapter.actualWords, 0).toLocaleString("zh-CN")} 字
        </div>
      </header>

      <div className="draft-toolbar">
        <label>
          <Search size={15} />
          <input value={query} placeholder="搜索标题、目标或备注" onChange={(event) => setQuery(event.target.value)} />
        </label>
        <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
          <option value="all">全部状态</option>
          {Object.entries(statusLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div className="draft-list">
        {visible.map(({ chapter, volume }) => (
          <article className={`draft-row ${chapter.id === current?.plan.id ? "active" : ""}`} key={chapter.id}>
            <span className="draft-number">{String(chapter.number).padStart(2, "0")}</span>
            <div>
              <strong>{chapter.title}</strong>
              <small>
                {volume.title} · {chapter.goal || "尚未填写章节目标"}
              </small>
            </div>
            <span className={`draft-status ${chapter.status}`}>{statusLabels[chapter.status]}</span>
            <span className="draft-words">
              {chapter.actualWords.toLocaleString("zh-CN")} / {chapter.targetWords.toLocaleString("zh-CN")}
            </span>
            <span className="draft-history">
              <FileClock size={14} />
              {historyCounts[chapter.id] ?? 0}
            </span>
            <button type="button" onClick={() => void open(chapter)}>
              <FilePenLine size={15} />
              编辑
            </button>
            <button
              className="icon-button"
              type="button"
              title={chapter.archived ? "移出归档" : "归档章节"}
              aria-label={chapter.archived ? "移出归档" : "归档章节"}
              onClick={() => void updateChapterPlan(chapter.id, { archived: !chapter.archived })}
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
    </section>
  );
};
