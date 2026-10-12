import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookOpenCheck,
  Database,
  FileSearch,
  Fingerprint,
  GitBranch,
  LoaderCircle,
  Pause,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles
} from "lucide-react";
import {
  CanonFactSchema,
  ChapterContractSchema,
  StoryThreadSchema,
  type CanonFact,
  type EvidencePack,
  type StoryThread,
  type StyleProfile
} from "@inkforge/schemas";
import { bridge } from "@/lib/browserBridge";
import { requireSavedChapter } from "@/lib/requireSavedChapter";
import { useProjectAutomation } from "@/lib/useProjectAutomation";
import { useProjectStore } from "@/stores/useProjectStore";

type Tab = "setup" | "canon" | "threads" | "style" | "write";
type CorpusImport = Awaited<ReturnType<typeof bridge.listCorpusImports>>[number];
type AnalysisJob = Awaited<ReturnType<typeof bridge.listAnalysisJobs>>[number];
type IndexStats = Awaited<ReturnType<typeof bridge.getChunkIndexStats>>;
type ContinuationRun = Awaited<ReturnType<typeof bridge.listContinuationRuns>>[number];

const splitLines = (value: string) =>
  value
    .split(/\r?\n/u)
    .map((item) => item.trim())
    .filter(Boolean);

export const ContinuationWorkbench = () => {
  const project = useProjectStore((state) => state.project);
  const current = useProjectStore((state) => state.current);
  const [tab, setTab] = useState<Tab>("setup");
  const [imports, setImports] = useState<CorpusImport[]>([]);
  const [jobs, setJobs] = useState<AnalysisJob[]>([]);
  const [facts, setFacts] = useState<CanonFact[]>([]);
  const [threads, setThreads] = useState<StoryThread[]>([]);
  const [styleProfile, setStyleProfile] = useState<StyleProfile>();
  const [indexStats, setIndexStats] = useState<IndexStats>();
  const [sourcePath, setSourcePath] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchHits, setSearchHits] = useState<Awaited<ReturnType<typeof bridge.searchContinuation>>["hits"]>([]);
  const [evidencePack, setEvidencePack] = useState<EvidencePack>();
  const [runs, setRuns] = useState<ContinuationRun[]>([]);
  const [instruction, setInstruction] = useState("");
  const [mustHappen, setMustHappen] = useState("");
  const [mustNotHappen, setMustNotHappen] = useState("");
  const [targetWords, setTargetWords] = useState("3000");
  const [allowCompression, setAllowCompression] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const projectPath = project?.projectPath;
  const { settings: automation, update: updateAutomation } = useProjectAutomation(projectPath);
  const chapterId = current?.plan.id;

  const refresh = useCallback(async () => {
    if (!projectPath) return;
    const [nextImports, nextJobs, nextFacts, nextThreads, nextProfile, nextStats, nextRuns] = await Promise.all([
      bridge.listCorpusImports(projectPath),
      bridge.listAnalysisJobs(projectPath),
      bridge.listCanonFacts(projectPath),
      bridge.listStoryThreads(projectPath),
      bridge.loadStyleProfile(projectPath),
      bridge.getChunkIndexStats(projectPath),
      bridge.listContinuationRuns(projectPath, chapterId)
    ]);
    setImports(nextImports);
    setJobs(nextJobs);
    setFacts(nextFacts);
    setThreads(nextThreads);
    setStyleProfile(nextProfile);
    setIndexStats(nextStats);
    setRuns(nextRuns);
  }, [chapterId, projectPath]);

  useEffect(() => {
    void refresh().catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
  }, [refresh]);

  const runAction = async (label: string, action: () => Promise<unknown>, success: string) => {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(success);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy("");
    }
  };

  const targetWordsValue = Number(targetWords);
  const validTargetWords = Number.isInteger(targetWordsValue) && targetWordsValue >= 200 && targetWordsValue <= 10000;
  const contract = useMemo(
    () =>
      chapterId && validTargetWords
        ? ChapterContractSchema.parse({
            chapterId,
            title: current?.plan.title ?? "",
            targetWords: targetWordsValue,
            mustHappen: splitLines(mustHappen),
            mustNotHappen: splitLines(mustNotHappen),
            requiredEntityIds: current?.plan.characters ?? [],
            requiredThreadIds: threads.filter((thread) => thread.status === "due").map((thread) => thread.id),
            dueThreadIds: threads.filter((thread) => thread.status === "due").map((thread) => thread.id)
          })
        : undefined,
    [
      chapterId,
      current?.plan.characters,
      current?.plan.title,
      mustHappen,
      mustNotHappen,
      targetWordsValue,
      validTargetWords,
      threads
    ]
  );

  if (!project || !projectPath) return null;

  const addCandidateFact = async () => {
    const subjectId = window.prompt("事实主体 ID（人物/地点/项目）")?.trim();
    if (!subjectId) return;
    const predicate = window.prompt("事实谓词，例如 power_level / located_at")?.trim();
    if (!predicate) return;
    const objectValue = window.prompt("事实值")?.trim();
    if (!objectValue) return;
    const fact = CanonFactSchema.parse({
      id: `fact-${crypto.randomUUID()}`,
      subjectId,
      predicate,
      objectValue,
      certainty: 1,
      status: "candidate",
      evidence: [],
      source: "author",
      notes: "待补原文证据"
    });
    await runAction("fact", () => bridge.saveCanonFact(projectPath, fact), "正典候选已保存。");
  };

  const addThread = async () => {
    const title = window.prompt("剧情线标题")?.trim();
    if (!title) return;
    const expectedPayoff = window.prompt("预期回收方式（可留空）")?.trim() ?? "";
    const thread = StoryThreadSchema.parse({
      id: `thread-${crypto.randomUUID()}`,
      title,
      type: "foreshadowing",
      status: "candidate",
      expectedPayoff,
      confidence: 1,
      locked: false,
      notes: "作者新增候选"
    });
    await runAction("thread", () => bridge.saveStoryThread(projectPath, thread), "剧情线已保存。");
  };

  return (
    <section className="continuation-workbench">
      <header className="continuation-hero">
        <div>
          <span className="eyebrow">LONG NOVEL CONTINUATION</span>
          <h1>续写工程</h1>
          <p>先建立可追溯的正典与文风基线，再生成可检查、可回滚的续写分支。</p>
        </div>
        <button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={() => void refresh()}>
          <RefreshCw size={15} /> 刷新
        </button>
      </header>

      <div className="continuation-metrics">
        <Metric label="语料章节" value={imports.reduce((total, item) => total + item.chapters.length, 0)} />
        <Metric label="索引 Chunk" value={indexStats?.chunkCount ?? 0} />
        <Metric label="正典事实" value={facts.length} />
        <Metric label="到期剧情线" value={threads.filter((thread) => thread.status === "due").length} />
        <Metric label="文风基线" value={styleProfile ? `v${styleProfile.version}` : "未建立"} />
      </div>

      <nav className="continuation-tabs" aria-label="续写工程模块">
        {(
          [
            ["setup", "建档", Database],
            ["canon", "正典", ShieldCheck],
            ["threads", "剧情线", GitBranch],
            ["style", "文风", Fingerprint],
            ["write", "续写", Sparkles]
          ] as const
        ).map(([id, label, Icon]) => (
          <button className={tab === id ? "active" : ""} type="button" key={id} onClick={() => setTab(id)}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </nav>

      {notice ? <div className="success-banner compact">{notice}</div> : null}
      {error ? <div className="error-banner compact">{error}</div> : null}

      {tab === "setup" ? (
        <div className="continuation-grid two">
          <article className="continuation-card">
            <h2>流式导入</h2>
            <p>正文由主进程流式读取，支持 UTF-8、GB18030、断点恢复和重复检测。</p>
            <div className="continuation-inline">
              <input
                value={sourcePath}
                onChange={(event) => setSourcePath(event.target.value)}
                placeholder="文稿文件或目录路径"
                aria-label="续写语料路径"
              />
              <button
                className="secondary-button"
                type="button"
                onClick={() => void bridge.chooseCorpusSource().then((value) => value && setSourcePath(value))}
              >
                选择
              </button>
              <button
                className="primary-button"
                type="button"
                disabled={!sourcePath.trim() || Boolean(busy)}
                onClick={() =>
                  void runAction(
                    "import",
                    () => bridge.startCorpusImport({ projectPath, sourcePath: sourcePath.trim() }),
                    "语料导入完成。"
                  )
                }
              >
                {busy === "import" ? <LoaderCircle className="spin" size={15} /> : <Play size={15} />} 导入
              </button>
            </div>
            <div className="continuation-list">
              {imports.map((item) => (
                <div className="continuation-row" key={item.id}>
                  <div>
                    <strong>{item.sourcePath}</strong>
                    <small>
                      {item.status} · {item.chapters.length} 章 · 重复 {item.duplicateChapterIds.length}
                    </small>
                  </div>
                  <div className="row-actions">
                    {item.status === "running" ? (
                      <button
                        type="button"
                        onClick={() =>
                          void runAction("pause", () => bridge.pauseCorpusImport(projectPath, item.id), "已暂停。")
                        }
                      >
                        <Pause size={14} />
                      </button>
                    ) : null}
                    {item.status === "paused" ? (
                      <button
                        type="button"
                        onClick={() =>
                          void runAction(
                            "resume",
                            () => bridge.resumeCorpusImport(projectPath, item.id),
                            "导入已继续。"
                          )
                        }
                      >
                        <Play size={14} />
                      </button>
                    ) : null}
                    {item.status === "completed" ? (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            void runAction(
                              "adopt",
                              () => bridge.adoptCorpusImport({ projectPath, importId: item.id }),
                              "导入章节已并入项目。"
                            )
                          }
                        >
                          并入项目
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void runAction(
                              "analysis",
                              () => bridge.startAnalysisJob({ projectPath, importId: item.id }),
                              "确定性分析完成。"
                            )
                          }
                        >
                          分析
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="continuation-card">
            <h2>分析与增量索引</h2>
            <p>分析任务按章节内容哈希复用结果；修改一章只重建这一章的索引。</p>
            <div className="continuation-inline">
              <button
                className="primary-button"
                type="button"
                disabled={Boolean(busy)}
                onClick={() => void runAction("index", () => bridge.indexProject(projectPath), "全项目索引已更新。")}
              >
                <FileSearch size={15} /> 更新索引
              </button>
              <span>{indexStats ? `${indexStats.chapterCount} 章 / ${indexStats.chunkCount} chunks` : "尚未索引"}</span>
            </div>
            <div className="continuation-list">
              {jobs.map((job) => (
                <div className="continuation-row" key={job.id}>
                  <div>
                    <strong>分析任务 {job.id.slice(0, 8)}</strong>
                    <small>
                      {job.status} · {job.completedTasks}/{job.tasks.length}
                    </small>
                  </div>
                </div>
              ))}
            </div>
            <div className="continuation-search">
              <input
                value={searchQuery}
                aria-label="检索续写证据"
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="测试人物、设定或伏笔召回"
              />
              <button
                className="secondary-button"
                type="button"
                disabled={!searchQuery.trim()}
                onClick={() =>
                  void bridge.searchContinuation(projectPath, searchQuery).then((result) => setSearchHits(result.hits))
                }
              >
                <Search size={15} /> 检索
              </button>
            </div>
            {searchHits.slice(0, 8).map((hit) => (
              <blockquote key={hit.id}>
                <strong>{hit.chapterTitle}</strong> · {hit.retrievalMode}
                <br />
                {hit.snippet}
              </blockquote>
            ))}
          </article>
        </div>
      ) : null}

      {tab === "canon" ? (
        <article className="continuation-card">
          <div className="continuation-card-title">
            <div>
              <h2>正典收件箱</h2>
              <p>候选不会自动成为事实；确认和锁定前必须补充原文证据。</p>
            </div>
            <button className="primary-button" type="button" onClick={() => void addCandidateFact()}>
              新增候选
            </button>
          </div>
          <div className="continuation-table">
            {facts.map((fact) => (
              <div className="continuation-row" key={fact.id}>
                <div>
                  <strong>
                    {fact.subjectId}.{fact.predicate}
                  </strong>
                  <span>{JSON.stringify(fact.objectValue)}</span>
                  <small>
                    {fact.status} · 证据 {fact.evidence.length} · 置信度 {Math.round(fact.certainty * 100)}%
                  </small>
                </div>
                <div className="row-actions">
                  {fact.status === "candidate" && fact.evidence.length ? (
                    <button
                      type="button"
                      onClick={() =>
                        void runAction(
                          "fact-status",
                          () => bridge.setCanonFactStatus(projectPath, fact.id, "confirmed"),
                          "事实已确认。"
                        )
                      }
                    >
                      确认
                    </button>
                  ) : null}
                  {fact.status === "confirmed" ? (
                    <button
                      type="button"
                      onClick={() =>
                        void runAction(
                          "fact-lock",
                          () => bridge.setCanonFactStatus(projectPath, fact.id, "author_locked"),
                          "事实已锁定。"
                        )
                      }
                    >
                      锁定
                    </button>
                  ) : null}
                  {fact.status !== "rejected" ? (
                    <button
                      type="button"
                      onClick={() =>
                        void runAction(
                          "fact-reject",
                          () => bridge.setCanonFactStatus(projectPath, fact.id, "rejected"),
                          "候选已驳回。"
                        )
                      }
                    >
                      驳回
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </article>
      ) : null}

      {tab === "threads" ? (
        <article className="continuation-card">
          <div className="continuation-card-title">
            <div>
              <h2>剧情线雷达</h2>
              <p>管理埋设、推进、回收窗口和依赖关系。</p>
            </div>
            <button className="primary-button" type="button" onClick={() => void addThread()}>
              新增剧情线
            </button>
          </div>
          <div className="thread-board">
            {(["candidate", "active", "progressing", "due", "resolved"] as const).map((status) => (
              <section key={status}>
                <h3>{status}</h3>
                {threads
                  .filter((thread) => thread.status === status)
                  .map((thread) => (
                    <button
                      className="thread-card"
                      type="button"
                      key={thread.id}
                      onClick={() =>
                        status === "candidate"
                          ? void runAction(
                              "thread-status",
                              () => bridge.setStoryThreadStatus(projectPath, thread.id, "active"),
                              "剧情线已激活。"
                            )
                          : undefined
                      }
                    >
                      <strong>{thread.title}</strong>
                      <span>{thread.expectedPayoff || "尚未定义回收"}</span>
                      <small>
                        埋设 {thread.setupRefs.length} · 推进 {thread.progressRefs.length} · 回收{" "}
                        {thread.payoffRefs.length}
                      </small>
                    </button>
                  ))}
              </section>
            ))}
          </div>
        </article>
      ) : null}

      {tab === "style" ? (
        <div className="continuation-grid two">
          <article className="continuation-card">
            <h2>文风基线</h2>
            <p>顺序读取全部章节，不把整本书拼进内存。</p>
            <button
              className="primary-button"
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void runAction("style", () => bridge.analyzeStyleProfile(projectPath), "文风基线已重建。")}
            >
              <Fingerprint size={15} /> 建立/更新基线
            </button>
            {styleProfile ? (
              <dl className="style-stats">
                <div>
                  <dt>平均句长</dt>
                  <dd>{styleProfile.sentenceLengthMean?.toFixed(1)}</dd>
                </div>
                <div>
                  <dt>平均段长</dt>
                  <dd>{styleProfile.paragraphLengthMean?.toFixed(1)}</dd>
                </div>
                <div>
                  <dt>对白占比</dt>
                  <dd>{Math.round((styleProfile.dialogueRatio ?? 0) * 100)}%</dd>
                </div>
                <div>
                  <dt>范例</dt>
                  <dd>{styleProfile.evidence.length}</dd>
                </div>
              </dl>
            ) : (
              <p className="empty-copy">尚未建立基线。</p>
            )}
          </article>
          <article className="continuation-card">
            <h2>禁用模式</h2>
            <p>锁定后的禁用表达会成为续写硬门禁。</p>
            {styleProfile?.forbiddenPatterns.length ? (
              <ul>
                {styleProfile.forbiddenPatterns.map((pattern) => (
                  <li key={pattern}>{pattern}</li>
                ))}
              </ul>
            ) : (
              <p className="empty-copy">暂无禁用模式，可在正典文件中维护。</p>
            )}
          </article>
        </div>
      ) : null}

      {tab === "write" ? (
        <div className="continuation-grid write-grid">
          <article className="continuation-card">
            <h2>章节契约</h2>
            {chapterId ? (
              <p>当前章节：{current?.plan.title}</p>
            ) : (
              <p className="error-banner compact">请先选择一个章节。</p>
            )}
            <label>
              续写要求
              <textarea
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
                placeholder="本章推进方向、场景气氛、不能擅自改变的安排"
              />
            </label>
            <label>
              必须发生（每行一项）
              <textarea value={mustHappen} onChange={(event) => setMustHappen(event.target.value)} />
            </label>
            <label>
              禁止发生（每行一项）
              <textarea value={mustNotHappen} onChange={(event) => setMustNotHappen(event.target.value)} />
            </label>
            <label>
              目标字数
              <input
                type="number"
                min={200}
                aria-label="目标字数"
                max={10000}
                value={targetWords}
                onChange={(event) => setTargetWords(event.target.value)}
                aria-invalid={!validTargetWords}
                aria-describedby={!validTargetWords ? "continuation-target-words-error" : undefined}
              />
              {!validTargetWords ? (
                <small id="continuation-target-words-error" className="provider-error" role="alert">
                  请输入 200 至 10000 之间的整数字数。
                </small>
              ) : null}
            </label>
            <div className="continuation-inline">
              <button
                className="secondary-button"
                type="button"
                disabled={!contract || Boolean(busy)}
                onClick={() =>
                  contract &&
                  void runAction(
                    "context",
                    async () =>
                      setEvidencePack(
                        await bridge.compileContinuationContext({
                          projectPath,
                          chapterId: chapterId!,
                          contract,
                          instruction
                        })
                      ),
                    "证据包已编译。"
                  )
                }
              >
                <BookOpenCheck size={15} /> 预览证据包
              </button>
              <button
                className="primary-button"
                type="button"
                disabled={!contract || !instruction.trim() || Boolean(busy)}
                onClick={() =>
                  contract &&
                  void runAction(
                    "generate",
                    async () => {
                      await requireSavedChapter(projectPath, chapterId!, useProjectStore.getState);
                      const result = await bridge.startContinuationRun({
                        projectPath,
                        chapterId: chapterId!,
                        contract,
                        instruction,
                        logicReview: automation.logicReview,
                        allowCompression,
                        updateProjectData: automation.updateProjectData,
                        yolo: automation.yolo
                      });
                      if (result.run.appliedAt)
                        await useProjectStore.getState().reloadCurrentChapterFromDisk(chapterId!);
                      if (result.error) throw new Error(result.error);
                      if (result.status === "blocked") setError("复核未通过，结果已保留，未写入正文。");
                    },
                    "续写结果已保存。"
                  )
                }
              >
                <Sparkles size={15} /> 生成续写分支
              </button>
            </div>
            <div className="continuation-automation">
              <label>
                <input
                  type="checkbox"
                  checked={allowCompression}
                  onChange={(event) => setAllowCompression(event.target.checked)}
                />
                允许编辑压缩正文
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={automation.logicReview}
                  onChange={(event) => updateAutomation({ logicReview: event.target.checked })}
                />
                逻辑编辑与独立复核
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={automation.updateProjectData}
                  onChange={(event) => updateAutomation({ updateProjectData: event.target.checked })}
                />
                接受正文后更新本书资料
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={automation.yolo}
                  onChange={(event) => updateAutomation({ yolo: event.target.checked })}
                />
                YOLO：免工具审批，通过检查后直接写入
              </label>
            </div>
          </article>
          <article className="continuation-card evidence-preview">
            <h2>证据与运行结果</h2>
            {evidencePack ? (
              <>
                <p>
                  硬约束 {evidencePack.hardConstraints.length} · 即时连续性 {evidencePack.immediateContinuity.length} ·
                  到期剧情线 {evidencePack.dueThreads.length} · 原文命中 {evidencePack.retrievedEvidence.length}
                </p>
                <pre>{JSON.stringify(evidencePack, null, 2)}</pre>
              </>
            ) : (
              <p className="empty-copy">先编译证据包，确认上下文再生成。</p>
            )}
            {runs.slice(0, 5).map((run) => (
              <div className={`continuation-run ${run.status}`} key={run.id}>
                <strong>
                  {run.status} · {run.chapterId}
                </strong>
                <small>
                  {run.validation
                    ? `硬失败 ${run.validation.hardFailures} / 软警告 ${run.validation.softWarnings}`
                    : "等待检查"}
                </small>
                {run.branchId ? <span>分支 {run.branchId.slice(0, 8)}</span> : null}
                {run.error ? <p className="error-banner compact">{run.error}</p> : null}
                {run.evidencePack?.sourceWarnings.length ? (
                  <details>
                    <summary>资料来源提醒（{run.evidencePack.sourceWarnings.length}）</summary>
                    <pre>{run.evidencePack.sourceWarnings.join("\n")}</pre>
                  </details>
                ) : null}
                {run.postAcceptWarning ? (
                  <p className="error-banner compact">正文已保存；{run.postAcceptWarning}</p>
                ) : null}
                <small>
                  {run.model ?? ""} · {run.usage?.totalTokens ?? "未知"} tokens ·{" "}
                  {run.appliedAt ? "已自动写入" : "未自动写入"}
                </small>
                {run.metrics ? (
                  <small>
                    {(run.metrics.durationMs / 1000).toFixed(1)} 秒 · 原段落保留{" "}
                    {Math.round(run.metrics.originalParagraphRetention * 100)}% · 估算成本{" "}
                    {run.metrics.estimatedCost?.toFixed(4) ?? "未配置价格"}
                  </small>
                ) : null}
                {run.logicReview ? (
                  <p>
                    逻辑修改 {run.logicReview.edit.changes.length} 处 · 独立复核{" "}
                    {run.logicReview.canApply ? "通过" : "未通过"}
                  </p>
                ) : null}
                {run.originalDraft ? (
                  <details>
                    <summary>写手原稿</summary>
                    <pre>{run.originalDraft}</pre>
                  </details>
                ) : null}
                {run.draft ? (
                  <details>
                    <summary>最终正文</summary>
                    <pre>{run.draft}</pre>
                  </details>
                ) : null}
                {run.logicReview ? (
                  <details>
                    <summary>修改依据与复核</summary>
                    <pre>
                      {JSON.stringify(
                        {
                          changes: run.logicReview.edit.changes,
                          findings: run.logicReview.verification.findings,
                          unresolved: [
                            ...run.logicReview.edit.unresolvedIssues,
                            ...run.logicReview.verification.unresolvedIssues
                          ]
                        },
                        null,
                        2
                      )}
                    </pre>
                  </details>
                ) : null}
                <details>
                  <summary>导出运行记录与训练协议</summary>
                  <button
                    type="button"
                    onClick={() => {
                      const url = URL.createObjectURL(
                        new Blob([JSON.stringify(run, null, 2)], { type: "application/json" })
                      );
                      const anchor = document.createElement("a");
                      anchor.href = url;
                      anchor.download = `continuation-${run.id}.json`;
                      anchor.click();
                      URL.revokeObjectURL(url);
                    }}
                  >
                    下载 JSON
                  </button>
                </details>
                {run.branchId && run.status === "completed" && !run.appliedAt ? (
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void runAction(
                        "apply",
                        async () => {
                          await requireSavedChapter(projectPath, run.chapterId, useProjectStore.getState);
                          await bridge.applyStoryBranch(projectPath, run.branchId!);
                          await useProjectStore.getState().reloadCurrentChapterFromDisk(run.chapterId);
                        },
                        "分支已写入正文。"
                      )
                    }
                  >
                    接受正文
                  </button>
                ) : null}
                {["failed", "blocked", "cancelled"].includes(run.status) ? (
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void runAction(
                        "retry",
                        async () => {
                          await requireSavedChapter(projectPath, run.chapterId, useProjectStore.getState);
                          return bridge.retryContinuationRun(projectPath, run.id, { allowCompression });
                        },
                        "重试结果已保存。"
                      )
                    }
                  >
                    重新生成
                  </button>
                ) : null}
              </div>
            ))}
          </article>
        </div>
      ) : null}
    </section>
  );
};

const Metric = ({ label, value }: { label: string; value: string | number }) => (
  <div>
    <span>{label}</span>
    <strong>{value}</strong>
  </div>
);
