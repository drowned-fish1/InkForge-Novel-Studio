import { FormEvent, useEffect, useMemo, useState } from "react";
import { ClipboardCheck, Import, MessageSquarePlus, PackageCheck, RotateCcw, Save, StopCircle } from "lucide-react";
import type { PlanningImportSelection, PlanningPackage } from "@/types/app";
import { useLibraryStore } from "@/stores/useLibraryStore";
import { usePlanningStore } from "@/stores/usePlanningStore";
import { useProjectStore } from "@/stores/useProjectStore";

type ImportSelectionKey = "characters" | "worldEntries" | "timeline" | "terms" | "clues" | "outlineVolumeIds";
type ImportOverwriteKey = keyof NonNullable<PlanningImportSelection["overwrite"]>;

const emptySelection: PlanningImportSelection = {
  characters: [],
  worldEntries: [],
  timeline: [],
  terms: [],
  clues: [],
  outlineVolumeIds: [],
  overwrite: {
    characters: [],
    worldEntries: [],
    timeline: [],
    terms: [],
    clues: [],
    outlineVolumeIds: []
  }
};

export const PlanningPanel = () => {
  const project = useProjectStore((state) => state.project);
  const sessions = usePlanningStore((state) => state.planningSessions);
  const activeId = usePlanningStore((state) => state.activePlanningSessionId);
  const planningRunning = usePlanningStore((state) => state.planningRunning);
  const importResult = usePlanningStore((state) => state.lastPlanningImportResult);
  const rollbackSnapshotId = usePlanningStore((state) => state.lastPlanningRollbackSnapshotId);
  const error = useProjectStore((state) => state.error);
  const characters = useLibraryStore((state) => state.characters);
  const worldEntries = useLibraryStore((state) => state.worldEntries);
  const timeline = useLibraryStore((state) => state.timeline);
  const clues = useLibraryStore((state) => state.clues);
  const terms = useLibraryStore((state) => state.terms);
  const loadPlanningSessions = usePlanningStore((state) => state.loadPlanningSessions);
  const cancelPlanning = usePlanningStore((state) => state.cancelPlanning);
  const createPlanningSession = usePlanningStore((state) => state.createPlanningSession);
  const answerPlanningQuestion = usePlanningStore((state) => state.answerPlanningQuestion);
  const generatePlanningPackage = usePlanningStore((state) => state.generatePlanningPackage);
  const updatePlanningPackageDraft = usePlanningStore((state) => state.updatePlanningPackageDraft);
  const importPlanningPackage = usePlanningStore((state) => state.importPlanningPackage);
  const rollbackPlanningImport = usePlanningStore((state) => state.rollbackPlanningImport);
  const setSelectedModule = useProjectStore((state) => state.setSelectedModule);
  const [seed, setSeed] = useState("");
  const [answer, setAnswer] = useState("");
  const [jsonDraft, setJsonDraft] = useState("");
  const [selection, setSelection] = useState<PlanningImportSelection>(emptySelection);

  const active = useMemo(() => sessions.find((item) => item.id === activeId) ?? sessions[0], [activeId, sessions]);
  const planningPackage = active?.package;
  const importDiff = useMemo(() => {
    if (!planningPackage || !project) {
      return [];
    }
    return [
      createDiffRow(
        "人物",
        "characters",
        planningPackage.characters ?? [],
        selection.characters,
        selection.overwrite?.characters ?? [],
        characters,
        (item) => item.name
      ),
      createDiffRow(
        "世界设定",
        "worldEntries",
        planningPackage.worldEntries ?? [],
        selection.worldEntries,
        selection.overwrite?.worldEntries ?? [],
        worldEntries,
        (item) => item.title
      ),
      createDiffRow(
        "术语",
        "terms",
        planningPackage.terms ?? [],
        selection.terms,
        selection.overwrite?.terms ?? [],
        terms,
        (item) => item.name
      ),
      createDiffRow(
        "时间线",
        "timeline",
        planningPackage.timeline ?? [],
        selection.timeline,
        selection.overwrite?.timeline ?? [],
        timeline,
        (item) => item.title
      ),
      createDiffRow(
        "伏笔",
        "clues",
        planningPackage.clues ?? [],
        selection.clues,
        selection.overwrite?.clues ?? [],
        clues,
        (item) => item.title
      ),
      createDiffRow(
        "大纲分卷",
        "outlineVolumeIds",
        planningPackage.outline?.volumes ?? [],
        selection.outlineVolumeIds,
        selection.overwrite?.outlineVolumeIds ?? [],
        project.outline.volumes,
        (item) => item.title
      )
    ];
  }, [characters, clues, planningPackage, project, selection, terms, timeline, worldEntries]);

  useEffect(() => {
    void loadPlanningSessions();
  }, [loadPlanningSessions, project?.projectPath]);

  useEffect(() => {
    if (!planningPackage) {
      setJsonDraft("");
      setSelection(emptySelection);
      return;
    }
    setJsonDraft(JSON.stringify(planningPackage, null, 2));
    setSelection({
      characters: (planningPackage.characters ?? []).map((item) => item.id),
      worldEntries: (planningPackage.worldEntries ?? []).map((item) => item.id),
      timeline: (planningPackage.timeline ?? []).map((item) => item.id),
      terms: (planningPackage.terms ?? []).map((item) => item.id),
      clues: (planningPackage.clues ?? []).map((item) => item.id),
      outlineVolumeIds: (planningPackage.outline?.volumes ?? []).map((item) => item.id),
      overwrite: {
        characters: [],
        worldEntries: [],
        timeline: [],
        terms: [],
        clues: [],
        outlineVolumeIds: []
      }
    });
  }, [planningPackage]);

  const submitSeed = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void createPlanningSession(seed);
  };

  const submitAnswer = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!answer.trim()) {
      return;
    }
    void answerPlanningQuestion(answer.trim()).then(() => setAnswer(""));
  };

  const saveJsonDraft = () => {
    if (!active) {
      return;
    }
    const parsed = JSON.parse(jsonDraft) as PlanningPackage;
    void updatePlanningPackageDraft(active.id, parsed);
  };

  const toggle = (key: ImportSelectionKey, id: string) => {
    setSelection((current) => {
      const values = current[key];
      const selected = values.includes(id);
      return {
        ...current,
        [key]: selected ? values.filter((item) => item !== id) : [...values, id],
        overwrite: selected
          ? { ...current.overwrite, [key]: (current.overwrite?.[key] ?? []).filter((item) => item !== id) }
          : current.overwrite
      };
    });
  };

  const toggleOverwrite = (key: ImportOverwriteKey, id: string) => {
    setSelection((current) => {
      const values = current.overwrite?.[key] ?? [];
      return {
        ...current,
        overwrite: {
          ...current.overwrite,
          [key]: values.includes(id) ? values.filter((item) => item !== id) : [...values, id]
        }
      };
    });
  };

  return (
    <section className="planning-screen">
      <header className="library-header">
        <div>
          <div className="crumb">AI 规划模式</div>
          <h2>规划包与一键导入</h2>
        </div>
        {active ? (
          <button
            className="primary-button"
            type="button"
            disabled={planningRunning}
            onClick={() => void generatePlanningPackage(active.id)}
          >
            <PackageCheck size={17} />
            生成规划包
          </button>
        ) : null}
        {planningRunning ? (
          <button className="secondary-button cancel-button" type="button" onClick={cancelPlanning}>
            <StopCircle size={16} />
            取消
          </button>
        ) : null}
      </header>

      <div className="planning-layout">
        <aside className="planning-chat">
          <form className="planning-card" onSubmit={submitSeed}>
            <strong>1. 发起规划</strong>
            <textarea
              value={seed}
              placeholder="例如：我想写一本玄幻升级流，主角从边城开始，核心卖点是血脉、黑匣、宗门追杀。"
              onChange={(event) => setSeed(event.target.value)}
            />
            <button className="primary-button full" type="submit" disabled={planningRunning}>
              <MessageSquarePlus size={16} />
              开始追问
            </button>
          </form>

          <div className="planning-card chat-log">
            <strong>追问记录</strong>
            {active?.messages.length ? (
              active.messages.map((message) => (
                <div className={`chat-message ${message.role}`} key={message.id}>
                  <span>{message.role === "assistant" ? "AI" : message.role === "user" ? "作者" : "系统"}</span>
                  <p>{message.content}</p>
                </div>
              ))
            ) : (
              <p className="muted">还没有规划会话。</p>
            )}
          </div>

          {active ? (
            <form className="planning-card" onSubmit={submitAnswer}>
              <strong>2. 回答补充</strong>
              <textarea value={answer} onChange={(event) => setAnswer(event.target.value)} />
              <button className="secondary-button full" type="submit" disabled={planningRunning}>
                发送回答
              </button>
            </form>
          ) : null}
        </aside>

        <main className="planning-editor">
          <section className="planning-card package-summary">
            <strong>3. 结构化规划包</strong>
            {planningPackage ? (
              <div className="planning-stats">
                <span>人物 {planningPackage.characters?.length ?? 0}</span>
                <span>世界设定 {planningPackage.worldEntries?.length ?? 0}</span>
                <span>术语 {planningPackage.terms?.length ?? 0}</span>
                <span>时间线 {planningPackage.timeline?.length ?? 0}</span>
                <span>伏笔 {planningPackage.clues?.length ?? 0}</span>
                <span>分卷 {planningPackage.outline?.volumes?.length ?? 0}</span>
              </div>
            ) : (
              <p className="muted">回答完关键问题后，点击“生成规划包”。Provider 未配置时会生成可测试的示例规划包。</p>
            )}
            {error ? <div className="error-banner compact">{error}</div> : null}
          </section>

          {planningPackage ? (
            <>
              <section className="planning-card">
                <div className="section-heading">
                  <span>JSON 编辑器</span>
                  <button className="secondary-button compact" type="button" onClick={saveJsonDraft}>
                    <Save size={15} />
                    保存草稿
                  </button>
                </div>
                <textarea
                  className="json-editor"
                  value={jsonDraft}
                  onChange={(event) => setJsonDraft(event.target.value)}
                />
              </section>

              <section className="planning-card import-preview">
                <div className="section-heading">
                  <span>勾选导入</span>
                  <button
                    className="primary-button compact"
                    type="button"
                    disabled={planningRunning}
                    onClick={() => active && void importPlanningPackage(active.id, selection)}
                  >
                    <Import size={15} />
                    一键导入
                  </button>
                </div>
                <div className="planning-diff-preview">
                  {importDiff.map((row) => (
                    <article key={row.label} className={row.willSkip ? "has-skip" : ""}>
                      <strong>{row.label}</strong>
                      <span>
                        选中 {row.selected} / 新增 {row.willAdd} / 覆盖 {row.willOverwrite} / 跳过 {row.willSkip}
                      </span>
                      {row.examples.length ? <small>重复：{row.examples.join("、")}</small> : null}
                      {row.conflicts.length ? (
                        <div className="planning-conflict-list">
                          {row.conflicts.map((conflict) => (
                            <label key={conflict.id} className="planning-conflict-option">
                              <input
                                type="checkbox"
                                checked={row.overwriteIds.includes(conflict.id)}
                                onChange={() => toggleOverwrite(row.key, conflict.id)}
                              />
                              <span>
                                覆盖 {conflict.label}
                                <small>匹配已有：{conflict.existingLabel}</small>
                              </span>
                            </label>
                          ))}
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
                <Checklist
                  title="人物"
                  values={(planningPackage.characters ?? []).map((item) => [item.id, item.name])}
                  selected={selection.characters}
                  onToggle={(id) => toggle("characters", id)}
                />
                <Checklist
                  title="世界设定 / 境界"
                  values={(planningPackage.worldEntries ?? []).map((item) => [item.id, item.title])}
                  selected={selection.worldEntries}
                  onToggle={(id) => toggle("worldEntries", id)}
                />
                <Checklist
                  title="术语"
                  values={(planningPackage.terms ?? []).map((item) => [item.id, item.name])}
                  selected={selection.terms}
                  onToggle={(id) => toggle("terms", id)}
                />
                <Checklist
                  title="时间线"
                  values={(planningPackage.timeline ?? []).map((item) => [item.id, item.title])}
                  selected={selection.timeline}
                  onToggle={(id) => toggle("timeline", id)}
                />
                <Checklist
                  title="伏笔"
                  values={(planningPackage.clues ?? []).map((item) => [item.id, item.title])}
                  selected={selection.clues}
                  onToggle={(id) => toggle("clues", id)}
                />
                <Checklist
                  title="大纲分卷"
                  values={(planningPackage.outline?.volumes ?? []).map((item) => [item.id, item.title])}
                  selected={selection.outlineVolumeIds}
                  onToggle={(id) => toggle("outlineVolumeIds", id)}
                />
                {importResult ? (
                  <div className="success-banner compact planning-result-banner">
                    <ClipboardCheck size={15} />
                    <span>
                      快照 {importResult.snapshotId}；新增 {formatCounts(importResult.added)}；跳过{" "}
                      {formatCounts(importResult.skipped)}
                    </span>
                    <button
                      className="secondary-button compact"
                      type="button"
                      disabled={planningRunning}
                      onClick={() => void rollbackPlanningImport(importResult.snapshotId)}
                    >
                      <RotateCcw size={14} />
                      回滚
                    </button>
                  </div>
                ) : null}
                {rollbackSnapshotId ? (
                  <div className="success-banner compact">
                    <RotateCcw size={15} />
                    已回滚到快照 {rollbackSnapshotId}
                  </div>
                ) : null}
                <button className="tiny-text-button" type="button" onClick={() => setSelectedModule("overview")}>
                  导入后查看总览
                </button>
              </section>
            </>
          ) : null}
        </main>
      </div>
    </section>
  );
};

const Checklist = ({
  title,
  values,
  selected,
  onToggle
}: {
  title: string;
  values: Array<[string, string]>;
  selected: string[];
  onToggle: (id: string) => void;
}) => (
  <div className="planning-checklist">
    <strong>{title}</strong>
    {values.length ? (
      values.map(([id, label]) => (
        <label key={id}>
          <input type="checkbox" checked={selected.includes(id)} onChange={() => onToggle(id)} />
          <span>{label}</span>
        </label>
      ))
    ) : (
      <small>无</small>
    )}
  </div>
);

const createDiffRow = <T extends { id: string }, E extends { id: string }>(
  label: string,
  key: ImportOverwriteKey,
  packageItems: T[],
  selectedIds: string[],
  overwriteIds: string[],
  existingItems: E[],
  getLabel: (item: T | E) => string
) => {
  const selectedItems = packageItems.filter((item) => selectedIds.includes(item.id));
  const duplicates = selectedItems.flatMap((item) => {
    const existing = existingItems.find(
      (entry) => entry.id === item.id || normalizeImportKey(getLabel(entry)) === normalizeImportKey(getLabel(item))
    );
    return existing ? [{ id: item.id, label: getLabel(item), existingLabel: getLabel(existing) }] : [];
  });
  const overwriteCount = duplicates.filter((item) => overwriteIds.includes(item.id)).length;
  return {
    label,
    key,
    selected: selectedItems.length,
    willAdd: Math.max(0, selectedItems.length - duplicates.length),
    willOverwrite: overwriteCount,
    willSkip: Math.max(0, duplicates.length - overwriteCount),
    conflicts: duplicates,
    overwriteIds,
    examples: duplicates.map((item) => item.label).slice(0, 3)
  };
};

const normalizeImportKey = (value: string): string => value.trim().toLowerCase();

const formatCounts = (counts: Record<string, number>): string =>
  Object.entries(counts)
    .map(([key, value]) => `${key}:${value}`)
    .join("，") || "0";
