import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ClipboardList,
  Clock3,
  EyeOff,
  FileDiff,
  Flag,
  Gauge,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Search,
  Undo2,
  Wand2,
  Wrench
} from "lucide-react";
import type { QualitySweepResult, RevisionOverview, RevisionProposalSummary } from "@/types/app";
import { bridge } from "@/lib/browserBridge";
import { diffTextLines, summarizeDiff, type TextDiffLine } from "@/lib/textDiffLines";
import { mutateWritingWorkspace } from "@/lib/writingWorkspaceStore";
import { useProjectStore } from "@/stores/useProjectStore";

type ItemSource = "annotation" | "revision-mark" | "quality" | "continuity" | "proposal";
type ItemStatus = "open" | "accepted" | "ignored" | "deferred";
type SourceFilter = ItemSource | "all";
type StatusFilter = ItemStatus | "all";
type SortMode = "severity" | "time" | "chapter";

interface RevisionItem {
  key: string;
  source: ItemSource;
  severity: "info" | "warning" | "error";
  title: string;
  detail: string;
  chapterId?: string;
  chapterTitle?: string;
  createdAt: string;
  status: ItemStatus;
  annotationId?: string;
  proposal?: RevisionProposalSummary;
  suggestion?: string;
}

const sourceLabels: Record<ItemSource, string> = {
  annotation: "批注",
  "revision-mark": "待修改",
  quality: "质量",
  continuity: "连续性",
  proposal: "Agent 提案"
};

const sourceIcons: Record<ItemSource, typeof Flag> = {
  annotation: MessageSquareText,
  "revision-mark": Flag,
  quality: Gauge,
  continuity: Wand2,
  proposal: Wrench
};

const statusLabels: Record<ItemStatus, string> = {
  open: "待处理",
  accepted: "已接受",
  ignored: "已忽略",
  deferred: "已延期"
};

const severityRank: Record<RevisionItem["severity"], number> = { error: 0, warning: 1, info: 2 };

export const RevisionWorkbench = () => {
  const project = useProjectStore((state) => state.project);
  const selectChapter = useProjectStore((state) => state.selectChapter);
  const setSelectedModule = useProjectStore((state) => state.setSelectedModule);
  const [overview, setOverview] = useState<RevisionOverview | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open");
  const [chapterFilter, setChapterFilter] = useState("all");
  const [sortMode, setSortMode] = useState<SortMode>("severity");
  const [query, setQuery] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [busyKey, setBusyKey] = useState("");
  const [diffPreview, setDiffPreview] = useState<
    { proposal: RevisionProposalSummary; lines: TextDiffLine[]; added: number; removed: number } | undefined
  >();
  const [sweep, setSweep] = useState<QualitySweepResult | undefined>();
  const [sweeping, setSweeping] = useState(false);

  const runQualitySweep = async () => {
    if (!project) return;
    setSweeping(true);
    setError("");
    try {
      setSweep(await bridge.evaluateProjectQuality(project.projectPath));
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "全项目质量巡检失败");
    } finally {
      setSweeping(false);
    }
  };

  const refresh = async () => {
    if (!project) return;
    setLoading(true);
    setError("");
    try {
      setOverview(await bridge.revisionOverview(project.projectPath));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "读取修订数据失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setOverview(undefined);
    setSelectedKeys(new Set());
    setDiffPreview(undefined);
    setSweep(undefined);
    void refresh();
  }, [project?.projectPath]);

  const dispositionByKey = useMemo(
    () => new Map((overview?.revisionState.dispositions ?? []).map((item) => [item.key, item.status])),
    [overview?.revisionState]
  );

  const items = useMemo(() => {
    if (!overview) return [] as RevisionItem[];
    const result: RevisionItem[] = [];
    for (const annotation of overview.annotations) {
      result.push({
        key: `annotation:${annotation.id}`,
        source: annotation.kind === "revision" ? "revision-mark" : "annotation",
        severity: annotation.kind === "revision" ? "warning" : "info",
        title: annotation.quote ? `“${annotation.quote.slice(0, 60)}”` : "（无引文）",
        detail: annotation.note || (annotation.kind === "revision" ? "待修改" : "批注"),
        chapterId: annotation.chapterId,
        chapterTitle: annotation.chapterTitle,
        createdAt: annotation.createdAt,
        status: annotation.status === "resolved" ? "accepted" : annotation.status === "deferred" ? "deferred" : "open",
        annotationId: annotation.id
      });
    }
    for (const report of overview.qualityReports) {
      for (const finding of report.findings) {
        const key = `quality:${report.chapterId}:${finding.dimension}:${finding.title}`;
        result.push({
          key,
          source: "quality",
          severity: finding.severity,
          title: finding.title,
          detail: finding.detail,
          suggestion: finding.suggestion,
          chapterId: report.chapterId,
          chapterTitle: report.chapterTitle,
          createdAt: report.createdAt,
          status: dispositionByKey.get(key) ?? "open"
        });
      }
    }
    for (const issue of overview.continuityIssues) {
      const key = `continuity:${issue.id}`;
      result.push({
        key,
        source: "continuity",
        severity: issue.severity,
        title: issue.title,
        detail: issue.detail,
        createdAt: "",
        status: dispositionByKey.get(key) ?? "open"
      });
    }
    for (const proposal of overview.proposals) {
      const key = `proposal:${proposal.id}`;
      result.push({
        key,
        source: "proposal",
        severity: "warning",
        title: `${proposal.title} · ${proposal.chapterTitle}`,
        detail: proposal.explanation || proposal.contentPreview,
        chapterId: proposal.chapterId,
        chapterTitle: proposal.chapterTitle,
        createdAt: proposal.createdAt,
        status: dispositionByKey.get(key) ?? "open",
        proposal
      });
    }
    return result;
  }, [overview, dispositionByKey]);

  const chapters = useMemo(
    () => project?.outline.volumes.flatMap((volume) => volume.chapters) ?? [],
    [project?.outline.volumes]
  );

  const visible = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("zh-CN");
    const filtered = items.filter((item) => {
      if (sourceFilter !== "all" && item.source !== sourceFilter) return false;
      if (statusFilter !== "all" && item.status !== statusFilter) return false;
      if (chapterFilter !== "all" && item.chapterId !== chapterFilter) return false;
      if (keyword && !`${item.title} ${item.detail}`.toLocaleLowerCase("zh-CN").includes(keyword)) return false;
      return true;
    });
    return filtered.sort((left, right) => {
      if (sortMode === "severity") {
        return (
          severityRank[left.severity] - severityRank[right.severity] || right.createdAt.localeCompare(left.createdAt)
        );
      }
      if (sortMode === "time") {
        return right.createdAt.localeCompare(left.createdAt);
      }
      return (left.chapterTitle ?? "").localeCompare(right.chapterTitle ?? "", "zh-CN");
    });
  }, [items, sourceFilter, statusFilter, chapterFilter, query, sortMode]);

  const setAnnotationStatus = async (annotationId: string, status: "open" | "resolved" | "deferred") => {
    if (!project) return;
    await mutateWritingWorkspace(project.projectPath, (workspace) => ({
      ...workspace,
      annotations: workspace.annotations.map((item) => (item.id === annotationId ? { ...item, status } : item))
    }));
  };

  const applyItemAction = async (item: RevisionItem, action: ItemStatus) => {
    if (!project) return;
    if (item.annotationId) {
      const mapped = action === "accepted" ? "resolved" : action === "deferred" ? "deferred" : "open";
      if (action === "ignored") {
        throw new Error("批注请使用接受 / 延期，或在写作台删除。");
      }
      await setAnnotationStatus(item.annotationId, mapped);
      return;
    }
    if (item.proposal && action === "accepted") {
      if (item.proposal.kind === "change") {
        await bridge.resolveAgentChange({
          projectPath: project.projectPath,
          chapterId: item.proposal.chapterId,
          proposalId: item.proposal.id,
          action: "apply"
        });
      } else {
        await bridge.resolveAgentDataChange({
          projectPath: project.projectPath,
          chapterId: item.proposal.chapterId,
          proposalId: item.proposal.id,
          action: "apply"
        });
      }
      if (item.proposal.kind === "change") {
        try {
          const report = await bridge.evaluateChapterQuality(project.projectPath, item.proposal.chapterId);
          setNotice(
            `已写入《${item.proposal.chapterTitle}》。最新质量分 ${report.overallScore}${
              report.baselineDelta !== undefined
                ? `（较基线 ${report.baselineDelta >= 0 ? "+" : ""}${report.baselineDelta}）`
                : ""
            }。`
          );
        } catch {
          setNotice(`已写入《${item.proposal.chapterTitle}》。`);
        }
      }
      return;
    }
    if (item.proposal && action === "ignored") {
      if (item.proposal.kind === "change") {
        await bridge.resolveAgentChange({
          projectPath: project.projectPath,
          chapterId: item.proposal.chapterId,
          proposalId: item.proposal.id,
          action: "reject"
        });
      } else {
        await bridge.resolveAgentDataChange({
          projectPath: project.projectPath,
          chapterId: item.proposal.chapterId,
          proposalId: item.proposal.id,
          action: "reject"
        });
      }
      return;
    }
    await bridge.setRevisionDisposition(project.projectPath, item.key, action);
  };

  const runAction = async (item: RevisionItem, action: ItemStatus) => {
    setBusyKey(item.key);
    setError("");
    try {
      await applyItemAction(item, action);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败");
    } finally {
      setBusyKey("");
    }
  };

  const runBatch = async (action: ItemStatus) => {
    if (!selectedKeys.size) return;
    setBusyKey("__batch__");
    setError("");
    let failures = 0;
    for (const key of selectedKeys) {
      const item = items.find((candidate) => candidate.key === key);
      if (!item) continue;
      try {
        await applyItemAction(item, action);
      } catch {
        failures += 1;
      }
    }
    setSelectedKeys(new Set());
    await refresh();
    if (failures) {
      setError(`${failures} 个条目处理失败（批注不支持忽略）。`);
    }
    setBusyKey("");
  };

  const showProposalDiff = async (proposal: RevisionProposalSummary) => {
    if (!project) return;
    setDiffPreview(undefined);
    try {
      const session = await bridge.loadAgentChat(project.projectPath, proposal.chapterId);
      const full = session.proposals.find((item) => item.id === proposal.id);
      const chapter = chapters.find((item) => item.id === proposal.chapterId);
      const current = chapter ? await bridge.readChapter(project.projectPath, chapter.file) : "";
      let before = current;
      let after = current;
      if (full) {
        if (full.mode === "append") {
          after = `${current}\n${full.content}`;
        } else if (full.mode === "replace") {
          after = full.content;
        } else {
          before = full.blocks.map((block) => block.originalText).join("\n\n");
          after = full.blocks.map((block) => (block.operation === "delete" ? "" : block.proposedText)).join("\n\n");
        }
      }
      const lines = diffTextLines(before, after);
      setDiffPreview({ proposal, lines, ...summarizeDiff(lines) });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "读取提案差异失败");
    }
  };

  const openChapter = (chapterId?: string) => {
    const chapter = chapters.find((item) => item.id === chapterId);
    if (chapter) {
      void selectChapter(chapter).then(() => setSelectedModule("chapters"));
    }
  };

  const counts = useMemo(() => {
    const open = items.filter((item) => item.status === "open");
    return {
      open: open.length,
      marks: open.filter((item) => item.source === "revision-mark").length,
      proposals: open.filter((item) => item.source === "proposal").length
    };
  }, [items]);

  return (
    <section className="library-screen revision-workbench">
      <header className="library-header">
        <div>
          <div className="crumb">写作</div>
          <h2>修订工作台</h2>
          <p>集中处理批注、待修改标记、质量与连续性问题和 Agent 提案；全部来源都在本地，无需配置 AI。</p>
        </div>
        <div className="revision-header-side">
          <span>
            <ClipboardList size={16} />
            待处理 <b>{counts.open}</b> · 待修改 {counts.marks} · 提案 {counts.proposals}
          </span>
          <button
            className="secondary-button compact"
            type="button"
            disabled={sweeping || loading}
            title="对全部未归档章节运行本地质量评估并汇总结果"
            onClick={() => void runQualitySweep()}
          >
            {sweeping ? <Loader2 className="spinning" size={14} /> : <Gauge size={14} />}
            全项目质量巡检
          </button>
          <button className="secondary-button compact" type="button" disabled={loading} onClick={() => void refresh()}>
            {loading ? <Loader2 className="spinning" size={14} /> : <RefreshCw size={14} />}
            刷新
          </button>
        </div>
      </header>

      {sweep ? (
        <section className="quality-sweep-panel" aria-label="全项目质量巡检结果">
          <header>
            <strong>
              <Gauge size={14} />
              巡检结果 · {sweep.chapterCount} 章 · 均分 {sweep.averageScore}
              {sweep.continuityIssueCount ? ` · ${sweep.continuityIssueCount} 个一致性问题` : ""}
            </strong>
            <span className="muted">{new Date(sweep.generatedAt).toLocaleString("zh-CN")} · 按分数从低到高</span>
            <button className="tiny-text-button" type="button" onClick={() => setSweep(undefined)}>
              关闭
            </button>
          </header>
          <div className="quality-sweep-list">
            {sweep.entries.slice(0, 20).map((entry) => (
              <button key={entry.chapterId} type="button" onClick={() => openChapter(entry.chapterId)}>
                <strong className={entry.overallScore < 80 ? "low" : ""}>{entry.overallScore}</strong>
                {entry.baselineDelta !== undefined ? (
                  <em className={entry.baselineDelta >= 0 ? "up" : "down"}>
                    {entry.baselineDelta >= 0 ? "+" : ""}
                    {entry.baselineDelta}
                  </em>
                ) : null}
                <span>{entry.chapterTitle}</span>
                <small>
                  {entry.wordCount} 字{entry.warningCount ? ` · ${entry.warningCount} 警告` : ""}
                  {entry.topFinding ? ` · ${entry.topFinding}` : ""}
                </small>
              </button>
            ))}
            {sweep.entries.length > 20 ? (
              <span className="muted">仅显示分数最低的 20 章，共 {sweep.entries.length} 章。</span>
            ) : null}
            {!sweep.entries.length ? <span className="muted">没有可评估的章节。</span> : null}
          </div>
        </section>
      ) : null}

      {overview?.qualityReports.length ? (
        <div className="revision-quality-strip" aria-label="章节质量分">
          {overview.qualityReports.slice(0, 8).map((report) => (
            <button key={report.chapterId} type="button" onClick={() => setChapterFilter(report.chapterId)}>
              <strong>{report.overallScore}</strong>
              <span>{report.chapterTitle}</span>
              {report.baselineDelta !== undefined ? (
                <em className={report.baselineDelta >= 0 ? "up" : "down"}>
                  {report.baselineDelta >= 0 ? "+" : ""}
                  {report.baselineDelta}
                </em>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      {error ? <div className="error-banner">{error}</div> : null}
      {notice ? <div className="notice-banner">{notice}</div> : null}

      <div className="draft-toolbar revision-toolbar">
        <label>
          <Search size={15} />
          <input value={query} placeholder="搜索标题或说明" onChange={(event) => setQuery(event.target.value)} />
        </label>
        <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as SourceFilter)}>
          <option value="all">全部来源</option>
          {Object.entries(sourceLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
          <option value="all">全部状态</option>
          {Object.entries(statusLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select value={chapterFilter} onChange={(event) => setChapterFilter(event.target.value)}>
          <option value="all">全部章节</option>
          {chapters.map((chapter) => (
            <option key={chapter.id} value={chapter.id}>
              {chapter.title}
            </option>
          ))}
        </select>
        <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
          <option value="severity">按严重度</option>
          <option value="time">按时间</option>
          <option value="chapter">按章节</option>
        </select>
      </div>

      {selectedKeys.size ? (
        <div className="draft-batch-bar">
          <strong>已选 {selectedKeys.size} 项</strong>
          <button type="button" disabled={busyKey === "__batch__"} onClick={() => void runBatch("accepted")}>
            <CheckCircle2 size={14} />
            批量接受
          </button>
          <button type="button" disabled={busyKey === "__batch__"} onClick={() => void runBatch("ignored")}>
            <EyeOff size={14} />
            批量忽略
          </button>
          <button type="button" disabled={busyKey === "__batch__"} onClick={() => void runBatch("deferred")}>
            <Clock3 size={14} />
            批量延期
          </button>
          {busyKey === "__batch__" ? <Loader2 className="spinning" size={15} /> : null}
        </div>
      ) : null}

      {diffPreview ? (
        <section className="revision-diff-preview">
          <header>
            <strong>
              <FileDiff size={14} />
              {diffPreview.proposal.title} · {diffPreview.proposal.chapterTitle}
            </strong>
            <span className="muted">
              +{diffPreview.added} / -{diffPreview.removed} 行
            </span>
            <button className="tiny-text-button" type="button" onClick={() => setDiffPreview(undefined)}>
              关闭
            </button>
          </header>
          <pre>
            {diffPreview.lines
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
          </pre>
        </section>
      ) : null}

      <div className="revision-list">
        {visible.map((item) => {
          const Icon = sourceIcons[item.source];
          return (
            <article className={`revision-row severity-${item.severity} status-${item.status}`} key={item.key}>
              <input
                type="checkbox"
                aria-label={`选择 ${item.title}`}
                checked={selectedKeys.has(item.key)}
                onChange={() =>
                  setSelectedKeys((state) => {
                    const next = new Set(state);
                    if (next.has(item.key)) {
                      next.delete(item.key);
                    } else {
                      next.add(item.key);
                    }
                    return next;
                  })
                }
              />
              <span className={`revision-source ${item.source}`}>
                <Icon size={14} />
                {sourceLabels[item.source]}
              </span>
              <div className="revision-body">
                <strong>{item.title}</strong>
                <small>{item.detail}</small>
                {item.suggestion ? <small className="revision-suggestion">建议：{item.suggestion}</small> : null}
              </div>
              {item.chapterTitle ? (
                <button className="revision-chapter" type="button" onClick={() => openChapter(item.chapterId)}>
                  {item.chapterTitle}
                </button>
              ) : (
                <span className="revision-chapter muted">全局</span>
              )}
              <span className={`revision-status ${item.status}`}>{statusLabels[item.status]}</span>
              <div className="revision-actions">
                {item.proposal ? (
                  <button type="button" title="查看修改前后差异" onClick={() => void showProposalDiff(item.proposal!)}>
                    <FileDiff size={14} />
                  </button>
                ) : null}
                {item.status === "open" ? (
                  <>
                    <button
                      type="button"
                      title={item.proposal ? "应用提案" : "接受"}
                      disabled={busyKey === item.key}
                      onClick={() => void runAction(item, "accepted")}
                    >
                      {busyKey === item.key ? <Loader2 className="spinning" size={14} /> : <CheckCircle2 size={14} />}
                    </button>
                    {!item.annotationId ? (
                      <button
                        type="button"
                        title={item.proposal ? "拒绝提案" : "忽略"}
                        disabled={busyKey === item.key}
                        onClick={() => void runAction(item, "ignored")}
                      >
                        <EyeOff size={14} />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      title="延期处理"
                      disabled={busyKey === item.key}
                      onClick={() => void runAction(item, "deferred")}
                    >
                      <Clock3 size={14} />
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    title="恢复为待处理"
                    disabled={busyKey === item.key || Boolean(item.proposal)}
                    onClick={() => void runAction(item, "open")}
                  >
                    <Undo2 size={14} />
                  </button>
                )}
              </div>
            </article>
          );
        })}
        {!visible.length && !loading ? (
          <div className="module-empty-state">
            <ClipboardList size={24} />
            <strong>{items.length ? "没有匹配的修订条目" : "暂时没有需要修订的内容"}</strong>
            <span>
              {items.length
                ? "调整筛选条件查看其他状态的条目。"
                : "在写作台添加批注或待修改标记、运行质量检查，或让 Agent 生成提案后，会汇总到这里。"}
            </span>
          </div>
        ) : null}
      </div>
    </section>
  );
};
