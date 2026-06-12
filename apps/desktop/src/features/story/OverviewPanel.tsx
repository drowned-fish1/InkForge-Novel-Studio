import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, BookOpen, CheckCircle2, FileText, Info, RefreshCw, ShieldCheck } from "lucide-react";
import { bridge } from "@/lib/browserBridge";
import { countCjkAwareWords } from "@/lib/textMetrics";
import { useLibraryStore } from "@/stores/useLibraryStore";
import { useProjectStore } from "@/stores/useProjectStore";

interface SummaryListItem {
  id: string;
  chapterId: string;
  chapterTitle: string;
  task: string;
  model: string;
  savedAt: string;
  snippet: string;
}

const iconBySeverity = {
  info: Info,
  warning: AlertTriangle,
  error: AlertTriangle
} as const;

export const OverviewPanel = () => {
  const project = useProjectStore((state) => state.project);
  const timeline = useLibraryStore((state) => state.timeline);
  const clues = useLibraryStore((state) => state.clues);
  const terms = useLibraryStore((state) => state.terms);
  const issues = useLibraryStore((state) => state.consistencyIssues);
  const inspectStory = useLibraryStore((state) => state.inspectStory);
  const [bodyWordTotal, setBodyWordTotal] = useState<number | undefined>();
  const [summaries, setSummaries] = useState<SummaryListItem[]>([]);
  const setSelectedModule = useProjectStore((state) => state.setSelectedModule);
  const selectChapter = useProjectStore((state) => state.selectChapter);
  const activeChapters = useMemo(
    () => project?.outline.volumes.flatMap((volume) => volume.chapters.filter((chapter) => !chapter.archived)) ?? [],
    [project?.outline.volumes]
  );
  const totalWords = activeChapters.reduce((sum, chapter) => sum + (chapter.actualWords ?? 0), 0);
  const doneChapters = activeChapters.filter((chapter) => chapter.status === "done").length;
  const completionRate = activeChapters.length ? Math.round((doneChapters / activeChapters.length) * 100) : 0;
  const volumeStats = useMemo(
    () =>
      project?.outline.volumes.map((volume, index) => {
        const words = volume.chapters
          .filter((chapter) => !chapter.archived)
          .reduce((sum, chapter) => sum + (chapter.actualWords ?? 0), 0);
        return { id: volume.id, title: volume.title, words, color: volumeColors[index % volumeColors.length] };
      }) ?? [],
    [project?.outline.volumes]
  );
  const updatedAt = project?.meta.updatedAt ? new Date(project.meta.updatedAt) : undefined;
  const todayKey = new Date().toLocaleDateString();
  const updatedToday = updatedAt ? updatedAt.toLocaleDateString() === todayKey : false;
  const todayWords = updatedToday ? (bodyWordTotal ?? totalWords) : 0;

  useEffect(() => {
    if (!project) {
      setBodyWordTotal(undefined);
      setSummaries([]);
      return;
    }
    void bridge
      .listChapterSummaries(project.projectPath)
      .then(setSummaries)
      .catch(() => setSummaries([]));
  }, [project?.projectPath]);

  useEffect(() => {
    if (!project) {
      setBodyWordTotal(undefined);
      return;
    }
    let cancelled = false;
    void Promise.all(
      activeChapters.map((chapter) =>
        bridge
          .readChapter(project.projectPath, chapter.file)
          .then((content) => countCjkAwareWords(content))
          .catch(() => chapter.actualWords ?? 0)
      )
    ).then((wordCounts) => {
      if (!cancelled) {
        setBodyWordTotal(wordCounts.reduce((sum, count) => sum + count, 0));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeChapters, project]);

  return (
    <section className="library-screen">
      <header className="library-header">
        <div>
          <div className="crumb">项目总览</div>
          <h2>{project?.meta.title ?? "未打开项目"}</h2>
        </div>
        <button className="primary-button" type="button" onClick={() => void inspectStory()}>
          <RefreshCw size={17} />
          本地检查
        </button>
        <button
          className="secondary-button"
          type="button"
          onClick={() => {
            const firstChapter = activeChapters[0];
            if (firstChapter) {
              void selectChapter(firstChapter).then(() => {
                setSelectedModule("chapters");
              });
            }
          }}
          title="切换到章节页面后，在 AI 任务面板的「设定辅助」中使用 AI 深度检查"
        >
          <ShieldCheck size={17} />
          AI 深度检查
        </button>
      </header>

      <section className="writing-stats-panel">
        <div className="overview-grid compact">
          <div className="stat-tile">
            <strong>{totalWords.toLocaleString("zh-CN")}</strong>
            <span>项目总字数</span>
          </div>
          <div className="stat-tile">
            <strong>
              {doneChapters}/{activeChapters.length}
            </strong>
            <span>完成章节</span>
          </div>
          <div className="stat-tile">
            <strong>{completionRate}%</strong>
            <span>完成率</span>
          </div>
          <div className="stat-tile">
            <strong>{todayWords.toLocaleString("zh-CN")}</strong>
            <span>今日写作字数估算</span>
          </div>
        </div>
        <div className="volume-word-panel">
          <div className="section-heading">
            <span>各卷字数分布</span>
            <span className="muted">{(bodyWordTotal ?? totalWords).toLocaleString("zh-CN")} 字正文</span>
          </div>
          <div className="volume-word-list">
            {volumeStats.map((volume) => {
              const ratio = totalWords ? Math.round((volume.words / totalWords) * 100) : 0;
              return (
                <div className="volume-word-row" key={volume.id}>
                  <span>{volume.title}</span>
                  <div className="volume-word-track">
                    <div style={{ width: `${ratio}%`, background: volume.color }} />
                  </div>
                  <small>
                    {volume.words.toLocaleString("zh-CN")} 字 · {ratio}%
                  </small>
                </div>
              );
            })}
            {!volumeStats.length ? <div className="empty-list-hint">还没有分卷数据。</div> : null}
          </div>
        </div>
      </section>

      <div className="overview-grid">
        <div className="stat-tile">
          <strong>{timeline.length}</strong>
          <span>时间线事件</span>
        </div>
        <div className="stat-tile">
          <strong>{clues.length}</strong>
          <span>伏笔</span>
        </div>
        <div className="stat-tile">
          <strong>{terms.length}</strong>
          <span>术语</span>
        </div>
        <div className="stat-tile">
          <strong>{issues.filter((item) => item.severity !== "info").length}</strong>
          <span>需处理问题</span>
        </div>
      </div>

      <section className="issue-list">
        <div className="section-heading">
          <span>本地一致性检查</span>
          <CheckCircle2 size={16} />
        </div>
        {issues.map((issue) => {
          const Icon = iconBySeverity[issue.severity];
          return (
            <article className={`issue-row ${issue.severity}`} key={issue.id}>
              <Icon size={17} />
              <div>
                <strong>{issue.title}</strong>
                <span>{issue.detail}</span>
              </div>
            </article>
          );
        })}
      </section>

      {summaries.length > 0 ? (
        <section className="summary-list-section">
          <div className="section-heading">
            <span>已保存的 AI 总结</span>
            <BookOpen size={16} />
          </div>
          <div className="summary-list">
            {summaries.map((item) => (
              <button
                className="summary-row"
                key={item.id}
                type="button"
                onClick={() => {
                  const chapter = activeChapters.find((c) => c.id === item.chapterId);
                  if (chapter) {
                    setSelectedModule("chapters");
                    useProjectStore.getState().selectChapter(chapter);
                  }
                }}
              >
                <FileText size={15} />
                <div className="summary-info">
                  <strong>{item.chapterTitle}</strong>
                  <span>
                    {item.task} · {item.model} · {new Date(item.savedAt).toLocaleString()}
                  </span>
                </div>
                <span className="summary-snippet">{item.snippet}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </section>
  );
};

const volumeColors = ["#16645c", "#9a5b2f", "#345b8c", "#7c5d9c", "#4f7a42", "#a04747"];
