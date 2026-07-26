import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BadgeCheck,
  Boxes,
  GitBranch,
  Gauge,
  Play,
  RefreshCw,
  Rocket,
  Save,
  ShieldCheck,
  Square,
  TestTube2
} from "lucide-react";
import type { BatchRun, BranchDiffLine, QualityReport, StoryBranch } from "@inkforge/schemas";
import type { ProviderPreset, ProviderProbeResult, ReleaseReadiness } from "../../../electron/types";
import { bridge } from "@/lib/browserBridge";
import { useProjectStore } from "@/stores/useProjectStore";
import { OverviewPanel } from "@/features/story/OverviewPanel";

type ProductionTab = "overview" | "quality" | "branches" | "batch" | "release";

const tabs: Array<{ id: ProductionTab; label: string; icon: typeof Gauge }> = [
  { id: "overview", label: "项目总览", icon: Gauge },
  { id: "quality", label: "质量评测", icon: ShieldCheck },
  { id: "branches", label: "剧情分支", icon: GitBranch },
  { id: "batch", label: "批量生产", icon: Boxes },
  { id: "release", label: "模型与发布", icon: Rocket }
];

export const ProductionWorkbench = () => {
  const [tab, setTab] = useState<ProductionTab>("overview");
  return (
    <section className="production-workbench">
      <nav className="production-tabs" aria-label="交付工作台">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            className={tab === id ? "active" : ""}
            key={id}
            type="button"
            aria-current={tab === id ? "page" : undefined}
            onClick={() => setTab(id)}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </nav>
      <div className="production-content">
        {tab === "overview" ? <OverviewPanel /> : null}
        {tab === "quality" ? <QualityPanel /> : null}
        {tab === "branches" ? <BranchPanel /> : null}
        {tab === "batch" ? <BatchPanel onOpenBranches={() => setTab("branches")} /> : null}
        {tab === "release" ? <ReleasePanel /> : null}
      </div>
    </section>
  );
};

const QualityPanel = () => {
  const project = useProjectStore((state) => state.project);
  const current = useProjectStore((state) => state.current);
  const chapters = useMemo(
    () => project?.outline.volumes.flatMap((volume) => volume.chapters.filter((chapter) => !chapter.archived)) ?? [],
    [project]
  );
  const [chapterId, setChapterId] = useState(current?.plan.id ?? chapters[0]?.id ?? "");
  const [reports, setReports] = useState<QualityReport[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const latest = reports[0];

  const load = async (nextChapterId = chapterId) => {
    if (!project || !nextChapterId) return;
    setReports(await bridge.listChapterQualityReports(project.projectPath, nextChapterId));
  };

  useEffect(() => {
    const next = chapters.some((chapter) => chapter.id === chapterId) ? chapterId : (chapters[0]?.id ?? "");
    if (next !== chapterId) setChapterId(next);
    void load(next).catch((reason) => setError(messageOf(reason)));
  }, [project?.projectPath, chapterId, chapters.length]);

  const evaluate = async () => {
    if (!project || !chapterId) return;
    setBusy(true);
    setError("");
    try {
      await bridge.evaluateChapterQuality(project.projectPath, chapterId);
      await load();
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ProductionPage
      eyebrow="QUALITY REGRESSION"
      title="小说质量评测"
      description="以确定性规则检查连续性、角色、节奏、文风、重复和伏笔，并把认可版本设为回归基线。"
      action={
        <button className="primary-button" type="button" disabled={!chapterId || busy} onClick={() => void evaluate()}>
          <TestTube2 size={16} />
          {busy ? "评测中…" : "运行评测"}
        </button>
      }
    >
      <div className="production-toolbar">
        <label>
          评测章节
          <select value={chapterId} onChange={(event) => setChapterId(event.target.value)}>
            {chapters.map((chapter) => (
              <option key={chapter.id} value={chapter.id}>
                {chapter.number}. {chapter.title}
              </option>
            ))}
          </select>
        </label>
        <span className="production-note">本地规则评测不消耗模型额度；同一正文指纹可用于稳定回归。</span>
      </div>
      {error ? <InlineError message={error} /> : null}
      {latest ? (
        <>
          <div className="quality-score-strip">
            <div className="quality-overall">
              <span>综合质量</span>
              <strong>{latest.overallScore}</strong>
              <small>
                {latest.baselineDelta === undefined
                  ? "尚未设置基线"
                  : `较基线 ${latest.baselineDelta >= 0 ? "+" : ""}${latest.baselineDelta}`}
              </small>
            </div>
            {Object.entries(latest.dimensionScores).map(([key, value]) => (
              <div className="quality-dimension" key={key}>
                <span>{qualityLabels[key] ?? key}</span>
                <strong>{value}</strong>
                <div>
                  <i style={{ width: `${value}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="production-split">
            <section className="production-card">
              <div className="production-card-heading">
                <div>
                  <strong>发现与建议</strong>
                  <span>
                    {latest.findings.length} 项 · {latest.wordCount} 字
                  </span>
                </div>
                <button
                  className="secondary-button compact"
                  type="button"
                  onClick={() =>
                    project &&
                    void bridge
                      .setChapterQualityBaseline(project.projectPath, chapterId, latest.id)
                      .then(() => load())
                      .catch((reason) => setError(messageOf(reason)))
                  }
                >
                  <BadgeCheck size={14} /> 设为基线
                </button>
              </div>
              <div className="finding-list">
                {latest.findings.map((finding) => (
                  <article className={`finding-row ${finding.severity}`} key={finding.id}>
                    <span>{qualityLabels[finding.dimension]}</span>
                    <div>
                      <strong>{finding.title}</strong>
                      <p>{finding.detail}</p>
                      <small>{finding.suggestion}</small>
                    </div>
                  </article>
                ))}
                {!latest.findings.length ? <EmptyState text="本轮未发现显著风险。" /> : null}
              </div>
            </section>
            <section className="production-card">
              <div className="production-card-heading">
                <div>
                  <strong>历史回归</strong>
                  <span>最近 {reports.length} 次</span>
                </div>
              </div>
              <div className="quality-history">
                {reports.map((report, index) => (
                  <div key={report.id}>
                    <span>{index === 0 ? "本次" : new Date(report.createdAt).toLocaleString("zh-CN")}</span>
                    <strong>{report.overallScore}</strong>
                    <small>{report.fingerprint.slice(0, 8)}</small>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </>
      ) : (
        <EmptyState text="选择章节并运行首次质量评测。" />
      )}
    </ProductionPage>
  );
};

const BranchPanel = () => {
  const project = useProjectStore((state) => state.project);
  const current = useProjectStore((state) => state.current);
  const saveCurrentChapter = useProjectStore((state) => state.saveCurrentChapter);
  const selectChapter = useProjectStore((state) => state.selectChapter);
  const chapters = useMemo(
    () => project?.outline.volumes.flatMap((volume) => volume.chapters.filter((chapter) => !chapter.archived)) ?? [],
    [project]
  );
  const [chapterId, setChapterId] = useState(current?.plan.id ?? chapters[0]?.id ?? "");
  const [branches, setBranches] = useState<StoryBranch[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState({ name: "", description: "", content: "" });
  const [diff, setDiff] = useState<BranchDiffLine[]>([]);
  const [error, setError] = useState("");
  const selected = branches.find((branch) => branch.id === selectedId);

  const load = async (nextChapterId = chapterId) => {
    if (!project) return;
    const next = await bridge.listStoryBranches(project.projectPath, nextChapterId || undefined);
    setBranches(next);
    if (selectedId && !next.some((branch) => branch.id === selectedId)) setSelectedId("");
  };

  useEffect(() => {
    const next = chapters.some((chapter) => chapter.id === chapterId) ? chapterId : (chapters[0]?.id ?? "");
    if (next !== chapterId) setChapterId(next);
    void load(next).catch((reason) => setError(messageOf(reason)));
  }, [project?.projectPath, chapterId, chapters.length]);

  useEffect(() => {
    if (selected) {
      setDraft({ name: selected.name, description: selected.description, content: selected.content });
      setDiff([]);
    }
  }, [selectedId]);

  const createBranch = async () => {
    if (!project || !chapterId) return;
    const branch = await bridge.createStoryBranch({
      projectPath: project.projectPath,
      chapterId,
      name: `剧情方案 ${branches.length + 1}`
    });
    await load();
    setSelectedId(branch.id);
  };

  const saveBranch = async () => {
    if (!project || !selected) return;
    await bridge.saveStoryBranch({ projectPath: project.projectPath, branchId: selected.id, ...draft });
    await load();
  };

  const compare = async () => {
    if (!project || !selected) return;
    setDiff(await bridge.compareStoryBranch(project.projectPath, selected.id));
  };

  const apply = async () => {
    if (!project || !selected || !window.confirm("应用后会替换当前章节正文，并自动保留历史快照。继续吗？")) return;
    if (current?.plan.id === selected.chapterId) {
      await saveCurrentChapter();
      if (useProjectStore.getState().saveState === "error") {
        throw new Error(useProjectStore.getState().error || "当前章节保存失败，分支没有应用。");
      }
    }
    await bridge.applyStoryBranch(project.projectPath, selected.id);
    if (current?.plan.id === selected.chapterId) {
      await selectChapter(current.plan);
    }
    await load();
  };

  return (
    <ProductionPage
      eyebrow="STORY BRANCHES"
      title="剧情分支与版本对比"
      description="每个方案保存创建时的基准正文；编辑、比较、应用互相隔离，应用前不会改动正式章节。"
      action={
        <button
          className="primary-button"
          type="button"
          disabled={!chapterId}
          onClick={() => void createBranch().catch((reason) => setError(messageOf(reason)))}
        >
          <GitBranch size={16} />
          新建分支
        </button>
      }
    >
      <div className="production-toolbar">
        <label>
          章节
          <select
            value={chapterId}
            onChange={(event) => {
              setChapterId(event.target.value);
              setSelectedId("");
            }}
          >
            {chapters.map((chapter) => (
              <option key={chapter.id} value={chapter.id}>
                {chapter.number}. {chapter.title}
              </option>
            ))}
          </select>
        </label>
        <span className="production-note">应用分支会自动创建章节历史版本，可随时从编辑器回滚。</span>
      </div>
      {error ? <InlineError message={error} /> : null}
      <div className="branch-layout">
        <aside className="branch-list">
          {branches.map((branch) => (
            <button
              className={branch.id === selectedId ? "active" : ""}
              key={branch.id}
              type="button"
              onClick={() => setSelectedId(branch.id)}
            >
              <GitBranch size={14} />
              <span>
                <strong>{branch.name}</strong>
                <small>
                  {branch.status} · {branch.source}
                </small>
              </span>
            </button>
          ))}
          {!branches.length ? <EmptyState text="还没有剧情分支。" /> : null}
        </aside>
        {selected ? (
          <section className="branch-editor production-card">
            <div className="branch-fields">
              <label>
                分支名称
                <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
              </label>
              <label>
                方案说明
                <input
                  value={draft.description}
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                  placeholder="记录核心取舍与风险"
                />
              </label>
            </div>
            <textarea
              aria-label="分支正文"
              value={draft.content}
              onChange={(event) => setDraft({ ...draft, content: event.target.value })}
            />
            <div className="branch-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => void saveBranch().catch((reason) => setError(messageOf(reason)))}
              >
                <Save size={15} />
                保存分支
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => void compare().catch((reason) => setError(messageOf(reason)))}
              >
                <Activity size={15} />
                与正文比较
              </button>
              <button
                className="primary-button"
                type="button"
                disabled={selected.status === "archived"}
                onClick={() => void apply().catch((reason) => setError(messageOf(reason)))}
              >
                <BadgeCheck size={15} />
                应用到正文
              </button>
            </div>
            {diff.length ? (
              <div className="branch-diff" aria-label="分支差异">
                {diff.map((line, index) => (
                  <div className={line.kind} key={`${index}-${line.text}`}>
                    <span>{line.kind === "add" ? "+" : line.kind === "remove" ? "−" : " "}</span>
                    <code>{line.text || " "}</code>
                  </div>
                ))}
              </div>
            ) : null}
          </section>
        ) : (
          <EmptyState text="选择一个分支开始编辑和比较。" />
        )}
      </div>
    </ProductionPage>
  );
};

const BatchPanel = ({ onOpenBranches }: { onOpenBranches: () => void }) => {
  const project = useProjectStore((state) => state.project);
  const chapters = useMemo(
    () => project?.outline.volumes.flatMap((volume) => volume.chapters.filter((chapter) => !chapter.archived)) ?? [],
    [project]
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [tokenBudget, setTokenBudget] = useState(12_000);
  const [checkpointEvery, setCheckpointEvery] = useState(1);
  const [runs, setRuns] = useState<BatchRun[]>([]);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    if (project) setRuns(await bridge.listBatchRuns(project.projectPath));
  };
  useEffect(() => {
    void load().catch((reason) => setError(messageOf(reason)));
  }, [project?.projectPath]);

  const create = async () => {
    if (!project) return;
    await bridge.createBatchRun({
      projectPath: project.projectPath,
      chapterIds: selectedIds,
      tokenBudget,
      checkpointEvery
    });
    setSelectedIds([]);
    await load();
  };
  const resume = async (runId: string) => {
    if (!project) return;
    setBusyId(runId);
    try {
      await bridge.resumeBatchRun(project.projectPath, runId);
      await load();
    } finally {
      setBusyId("");
    }
  };

  return (
    <ProductionPage
      eyebrow="BATCH PRODUCTION"
      title="批量章节生产"
      description="按令牌预算顺序生成，每到检查点暂停；所有产物先进入剧情分支，绝不自动覆盖正文。"
      action={
        <button
          className="primary-button"
          type="button"
          disabled={!selectedIds.length}
          onClick={() => void create().catch((reason) => setError(messageOf(reason)))}
        >
          <Boxes size={16} />
          创建批次
        </button>
      }
    >
      <div className="batch-builder production-card">
        <div className="batch-chapter-picker">
          {chapters.map((chapter) => (
            <label key={chapter.id}>
              <input
                type="checkbox"
                checked={selectedIds.includes(chapter.id)}
                onChange={(event) =>
                  setSelectedIds((ids) =>
                    event.target.checked ? [...ids, chapter.id] : ids.filter((id) => id !== chapter.id)
                  )
                }
              />
              <span>
                {chapter.number}. {chapter.title}
              </span>
              <small>目标 {chapter.targetWords} 字</small>
            </label>
          ))}
        </div>
        <div className="batch-controls">
          <label>
            总令牌预算
            <input
              type="number"
              min={1000}
              step={1000}
              value={tokenBudget}
              onChange={(event) => setTokenBudget(Number(event.target.value))}
            />
          </label>
          <label>
            每几章暂停检查
            <input
              type="number"
              min={1}
              max={10}
              value={checkpointEvery}
              onChange={(event) => setCheckpointEvery(Number(event.target.value))}
            />
          </label>
          <p>
            <ShieldCheck size={15} />
            预算不足时自动暂停；失败章节可再次执行。
          </p>
        </div>
      </div>
      {error ? <InlineError message={error} /> : null}
      <div className="batch-run-list">
        {runs.map((run) => (
          <article className="production-card batch-run" key={run.id}>
            <header>
              <div>
                <strong>批次 {run.id.slice(0, 8)}</strong>
                <span className={`status-chip ${run.status}`}>{batchStatusLabels[run.status]}</span>
              </div>
              <small>
                {run.usedTokens.toLocaleString()}/{run.tokenBudget.toLocaleString()} tokens
              </small>
            </header>
            <div className="batch-budget">
              <i style={{ width: `${Math.min(100, (run.usedTokens / run.tokenBudget) * 100)}%` }} />
            </div>
            <div className="batch-tasks">
              {run.tasks.map((task) => (
                <div key={task.id}>
                  <span className={`task-dot ${task.status}`} />
                  <strong>{task.chapterTitle}</strong>
                  <small>
                    {batchTaskStatusLabels[task.status]}
                    {task.qualityScore ? ` · 质量 ${task.qualityScore}` : ""}
                  </small>
                </div>
              ))}
            </div>
            <footer>
              <button
                className="primary-button"
                type="button"
                disabled={busyId === run.id || ["completed", "cancelled"].includes(run.status)}
                onClick={() => void resume(run.id).catch((reason) => setError(messageOf(reason)))}
              >
                <Play size={14} />
                {busyId === run.id ? "生成中…" : "执行至检查点"}
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={run.status === "cancelled"}
                onClick={() =>
                  project &&
                  void bridge
                    .cancelBatchRun(project.projectPath, run.id)
                    .then(load)
                    .catch((reason) => setError(messageOf(reason)))
                }
              >
                <Square size={13} />
                取消
              </button>
              {run.tasks.some((task) => task.branchId) ? (
                <button className="text-button" type="button" onClick={onOpenBranches}>
                  审阅生成分支 →
                </button>
              ) : null}
            </footer>
          </article>
        ))}
        {!runs.length ? <EmptyState text="选择章节、设置预算，然后创建第一个安全批次。" /> : null}
      </div>
    </ProductionPage>
  );
};

const ReleasePanel = () => {
  const project = useProjectStore((state) => state.project);
  const [presets, setPresets] = useState<ProviderPreset[]>([]);
  const [probe, setProbe] = useState<ProviderProbeResult>();
  const [readiness, setReadiness] = useState<ReleaseReadiness>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void bridge
      .listProviderPresets()
      .then(setPresets)
      .catch((reason) => setError(messageOf(reason)));
    if (project)
      void bridge
        .getReleaseReadiness(project.projectPath)
        .then(setReadiness)
        .catch((reason) => setError(messageOf(reason)));
  }, [project?.projectPath]);

  const inspect = async () => {
    if (!project) return;
    setBusy(true);
    setError("");
    try {
      const [nextProbe, nextReadiness] = await Promise.all([
        bridge.probeProvider(),
        bridge.getReleaseReadiness(project.projectPath)
      ]);
      setProbe(nextProbe);
      setReadiness(nextReadiness);
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ProductionPage
      eyebrow="MODEL & RELEASE"
      title="模型生态与发布就绪"
      description="统一 OpenAI 兼容协议接入云端、本地与网关模型；发布检查聚合正文、质量、分支和批量任务风险。"
      action={
        <button className="primary-button" type="button" disabled={busy} onClick={() => void inspect()}>
          <RefreshCw size={16} />
          {busy ? "检查中…" : "探测并检查"}
        </button>
      }
    >
      {error ? <InlineError message={error} /> : null}
      <div className="release-grid">
        <section className="production-card">
          <div className="production-card-heading">
            <div>
              <strong>兼容模型预设</strong>
              <span>在右侧 AI 助手设置中填写地址、模型与密钥</span>
            </div>
          </div>
          <div className="provider-preset-grid">
            {presets.map((preset) => (
              <article key={preset.id}>
                <span>{preset.category === "local" ? "LOCAL" : preset.category.toUpperCase()}</span>
                <strong>{preset.displayName}</strong>
                <p>{preset.description}</p>
                <small>
                  {preset.expectedCapabilities.streaming ? "流式" : "非流式"} ·{" "}
                  {preset.expectedCapabilities.tools ? "工具调用" : "聊天优先"}
                </small>
              </article>
            ))}
          </div>
          {probe ? (
            <div className={`probe-result ${probe.ok ? "ready" : "blocked"}`}>
              <Activity size={16} />
              <div>
                <strong>{probe.ok ? "模型连通" : "模型不可用"}</strong>
                <span>{probe.message}</span>
              </div>
              <small>{probe.latencyMs} ms</small>
            </div>
          ) : null}
        </section>
        <section className="production-card release-readiness">
          <div className="release-score">
            <span>发布就绪度</span>
            <strong>{readiness?.score ?? "—"}</strong>
            <small>{readiness?.ready ? "可继续打包" : "存在阻断项"}</small>
          </div>
          <div className="readiness-list">
            {readiness?.items.map((item) => (
              <div key={item.id}>
                <span className={`readiness-dot ${item.status}`} />
                <div>
                  <strong>{item.label}</strong>
                  <small>{item.detail}</small>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </ProductionPage>
  );
};

const ProductionPage = ({
  eyebrow,
  title,
  description,
  action,
  children
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <section className="production-page">
    <header className="production-header">
      <div>
        <span>{eyebrow}</span>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {action}
    </header>
    {children}
  </section>
);

const EmptyState = ({ text }: { text: string }) => (
  <div className="production-empty">
    <Boxes size={22} />
    <span>{text}</span>
  </div>
);
const InlineError = ({ message }: { message: string }) => <div className="production-error">{message}</div>;
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
const qualityLabels: Record<string, string> = {
  continuity: "连续性",
  character: "角色",
  pacing: "节奏",
  style: "文风",
  repetition: "重复",
  clue: "伏笔"
};
const batchStatusLabels: Record<BatchRun["status"], string> = {
  draft: "待开始",
  running: "运行中",
  paused: "检查点",
  completed: "已完成",
  cancelled: "已取消",
  failed: "失败"
};
const batchTaskStatusLabels: Record<BatchRun["tasks"][number]["status"], string> = {
  queued: "排队中",
  running: "生成中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消"
};
