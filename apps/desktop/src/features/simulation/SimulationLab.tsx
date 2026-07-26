import { useEffect, useMemo, useState } from "react";
import { FlaskConical, GitBranch, Play, Plus, Save, Square, Trash2 } from "lucide-react";
import { SimulationScenarioSchema, type SimulationBranch, type SimulationScenario } from "@inkforge/schemas";
import { bridge } from "@/lib/browserBridge";
import { useLibraryStore } from "@/stores/useLibraryStore";
import { useProjectStore } from "@/stores/useProjectStore";
import { useSimulationStore } from "@/stores/useSimulationStore";

const createScenario = (): SimulationScenario =>
  SimulationScenarioSchema.parse({
    id: `scenario_${Date.now()}`,
    title: "新推演场景"
  });

const splitLines = (value: string): string[] =>
  value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);

const branchToProse = (scenario: SimulationScenario, branch: SimulationBranch): string => {
  const turns = branch.turns
    .map((turn) => (turn.dialogue.trim() ? `${turn.action}\n「${turn.dialogue}」` : turn.action))
    .filter(Boolean);
  return [`（推演走向：${branch.premiseShift || branch.label}）`, ...turns, branch.outcome]
    .filter(Boolean)
    .join("\n\n");
};

export const SimulationLab = () => {
  const project = useProjectStore((state) => state.project);
  const characters = useLibraryStore((state) => state.characters);
  const loadLibraries = useLibraryStore((state) => state.loadLibraries);
  const documents = useSimulationStore((state) => state.documents);
  const activeScenarioId = useSimulationStore((state) => state.activeScenarioId);
  const running = useSimulationStore((state) => state.running);
  const runEvents = useSimulationStore((state) => state.runEvents);
  const error = useSimulationStore((state) => state.error);
  const loadSimulations = useSimulationStore((state) => state.loadSimulations);
  const setActiveScenario = useSimulationStore((state) => state.setActiveScenario);
  const saveScenario = useSimulationStore((state) => state.saveScenario);
  const runScenario = useSimulationStore((state) => state.runScenario);
  const cancelRun = useSimulationStore((state) => state.cancelRun);
  const reset = useSimulationStore((state) => state.reset);
  const [draft, setDraft] = useState<SimulationScenario | null>(null);
  const [branchHint, setBranchHint] = useState<string | null>(null);

  useEffect(() => {
    reset();
    setDraft(null);
    setBranchHint(null);
    if (project) {
      void loadSimulations();
      if (!characters.length) {
        void loadLibraries();
      }
    }
  }, [project?.projectPath]);

  const activeDocument = useMemo(
    () => documents.find((item) => item.scenario.id === activeScenarioId),
    [activeScenarioId, documents]
  );

  useEffect(() => {
    if (!activeScenarioId) {
      return;
    }
    const selected = documents.find((item) => item.scenario.id === activeScenarioId);
    if (!selected) {
      return;
    }
    setDraft(structuredClone(selected.scenario));
    setBranchHint(null);
  }, [activeScenarioId]);

  const chapters = useMemo(
    () => project?.outline.volumes.flatMap((volume) => volume.chapters.filter((chapter) => !chapter.archived)) ?? [],
    [project?.outline.volumes]
  );
  const latestRun = activeDocument?.runs[0];

  if (!project) {
    return (
      <section className="library-screen">
        <div className="library-empty">打开一个项目后即可使用故事推演。</div>
      </section>
    );
  }

  const startNewScenario = () => {
    const scenario = createScenario();
    setDraft(scenario);
    setActiveScenario(null);
  };

  const patchParticipant = (index: number, patch: Partial<SimulationScenario["participants"][number]>) => {
    if (!draft) {
      return;
    }
    setDraft({
      ...draft,
      participants: draft.participants.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item))
    });
  };

  const adoptBranch = async (branch: SimulationBranch) => {
    if (!draft?.chapterId) {
      return;
    }
    const created = await bridge.createStoryBranch({
      projectPath: project.projectPath,
      chapterId: draft.chapterId,
      name: `${draft.title} · ${branch.label}`,
      description: branch.premiseShift,
      content: branchToProse(draft, branch),
      source: "agent"
    });
    setBranchHint(`已存为故事分支「${created.name}」，可在生产台的分支列表中审阅。`);
  };

  return (
    <section className="library-screen">
      <header className="library-header">
        <div>
          <div className="crumb">剧情</div>
          <h2>故事推演</h2>
        </div>
        <button className="primary-button" type="button" onClick={startNewScenario}>
          <Plus size={17} />
          新场景
        </button>
      </header>
      <div className="library-layout">
        <aside className="library-list">
          {documents.map((document) => (
            <button
              key={document.scenario.id}
              className={activeScenarioId === document.scenario.id ? "selected" : ""}
              type="button"
              onClick={() => setActiveScenario(document.scenario.id)}
            >
              <FlaskConical size={17} />
              <span>
                <strong>{document.scenario.title}</strong>
                <small>
                  {document.scenario.participants.length} 个角色 · {document.runs.length} 次推演
                </small>
              </span>
            </button>
          ))}
          {!documents.length ? <div className="empty-list-hint">还没有推演场景。</div> : null}
        </aside>
        <div className="library-editor simulation-editor">
          {draft ? (
            <>
              <label>
                场景标题
                <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
              </label>
              <div className="field-grid">
                <label>
                  地点
                  <input
                    value={draft.location}
                    onChange={(event) => setDraft({ ...draft, location: event.target.value })}
                  />
                </label>
                <label>
                  关联章节（用于落回分支）
                  <select
                    value={draft.chapterId ?? ""}
                    onChange={(event) => setDraft({ ...draft, chapterId: event.target.value || undefined })}
                  >
                    <option value="">未关联</option>
                    {chapters.map((chapter) => (
                      <option key={chapter.id} value={chapter.id}>
                        {chapter.title}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                初始情形
                <textarea
                  rows={3}
                  placeholder="这场戏开始时发生了什么？"
                  value={draft.premise}
                  onChange={(event) => setDraft({ ...draft, premise: event.target.value })}
                />
              </label>
              <div className="field-grid">
                <label>
                  初始张力 {draft.initialTension}
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={draft.initialTension}
                    onChange={(event) => setDraft({ ...draft, initialTension: Number(event.target.value) })}
                  />
                </label>
                <label>
                  推演轮数（1–12）
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={draft.maxTurns}
                    onChange={(event) =>
                      setDraft({ ...draft, maxTurns: Math.min(12, Math.max(1, Number(event.target.value) || 1)) })
                    }
                  />
                </label>
              </div>
              <div className="field-grid">
                <label>
                  分叉数量
                  <select
                    value={draft.branchCount}
                    onChange={(event) => setDraft({ ...draft, branchCount: Number(event.target.value) })}
                  >
                    {[1, 2, 3].map((count) => (
                      <option key={count} value={count}>
                        {count} 条走向
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  推演禁忌（每行一条）
                  <textarea
                    rows={2}
                    placeholder="任何走向都不允许发生的事"
                    value={draft.taboos.join("\n")}
                    onChange={(event) => setDraft({ ...draft, taboos: splitLines(event.target.value) })}
                  />
                </label>
              </div>

              <div className="simulation-participants">
                <div className="simulation-section-title">
                  <span>参与角色</span>
                  <button
                    className="tiny-text-button"
                    type="button"
                    disabled={!characters.length}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        participants: [
                          ...draft.participants,
                          {
                            characterId:
                              characters.find(
                                (character) => !draft.participants.some((item) => item.characterId === character.id)
                              )?.id ??
                              characters[0]?.id ??
                              "",
                            goal: "",
                            knowledge: [],
                            hiddenAgenda: ""
                          }
                        ]
                      })
                    }
                  >
                    添加角色
                  </button>
                </div>
                {!characters.length ? (
                  <div className="empty-list-hint">人物库为空，先在「人物」模块创建角色卡。</div>
                ) : null}
                {draft.participants.map((participant, index) => (
                  <div className="simulation-participant" key={`${participant.characterId}-${index}`}>
                    <div className="simulation-participant-head">
                      <select
                        aria-label="选择角色"
                        value={participant.characterId}
                        onChange={(event) => patchParticipant(index, { characterId: event.target.value })}
                      >
                        {characters.map((character) => (
                          <option key={character.id} value={character.id}>
                            {character.name}
                          </option>
                        ))}
                      </select>
                      <button
                        className="micro-button"
                        type="button"
                        title="移除角色"
                        onClick={() =>
                          setDraft({
                            ...draft,
                            participants: draft.participants.filter((_, itemIndex) => itemIndex !== index)
                          })
                        }
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                    <input
                      placeholder="本场目标（覆盖角色卡动机）"
                      value={participant.goal}
                      onChange={(event) => patchParticipant(index, { goal: event.target.value })}
                    />
                    <input
                      placeholder="已掌握的信息，用逗号分隔"
                      value={participant.knowledge.join("，")}
                      onChange={(event) =>
                        patchParticipant(index, {
                          knowledge: event.target.value
                            .split(/[,，]/)
                            .map((item) => item.trim())
                            .filter(Boolean)
                        })
                      }
                    />
                    <input
                      placeholder="隐藏动机（其他角色不知道）"
                      value={participant.hiddenAgenda}
                      onChange={(event) => patchParticipant(index, { hiddenAgenda: event.target.value })}
                    />
                  </div>
                ))}
              </div>

              <div className="simulation-actions">
                <button className="secondary-button" type="button" onClick={() => void saveScenario(draft)}>
                  <Save size={15} />
                  保存场景
                </button>
                {running ? (
                  <button className="secondary-button" type="button" onClick={cancelRun}>
                    <Square size={15} />
                    停止推演
                  </button>
                ) : (
                  <button
                    className="primary-button"
                    type="button"
                    disabled={!draft.participants.length}
                    onClick={() => {
                      void saveScenario(draft).then(() => runScenario(draft.id));
                    }}
                  >
                    <Play size={15} />
                    开始推演
                  </button>
                )}
              </div>
              {error ? <div className="simulation-error">{error}</div> : null}
              {branchHint ? <div className="simulation-hint">{branchHint}</div> : null}

              {running && runEvents.length ? (
                <div className="simulation-events">
                  {runEvents.slice(-6).map((event) => (
                    <div key={event.id}>
                      <strong>{event.label}</strong>
                      {event.detail ? <small>{event.detail}</small> : null}
                    </div>
                  ))}
                </div>
              ) : null}

              {latestRun && !running ? (
                <div className="simulation-result">
                  <div className="simulation-section-title">
                    <span>
                      最近一次推演 ·{" "}
                      {latestRun.status === "completed"
                        ? "完成"
                        : latestRun.status === "cancelled"
                          ? "已取消"
                          : latestRun.status === "failed"
                            ? "失败"
                            : "进行中"}
                    </span>
                    <small>
                      {latestRun.model || "未知模型"} · {latestRun.usage.totalTokens} tokens
                    </small>
                  </div>
                  <div className="simulation-branches">
                    {latestRun.branches.map((branch) => (
                      <article className="simulation-branch" key={branch.id}>
                        <header>
                          <strong>{branch.label}</strong>
                          <small>{branch.premiseShift}</small>
                        </header>
                        <div className="simulation-turns">
                          {branch.turns.map((turn) => (
                            <div className="simulation-turn" key={turn.id}>
                              <small>
                                第 {turn.turn} 轮 · {turn.actorName}
                                {turn.intent ? ` · ${turn.intent}` : ""}
                              </small>
                              <p>{turn.action}</p>
                              {turn.dialogue ? <p className="simulation-dialogue">「{turn.dialogue}」</p> : null}
                            </div>
                          ))}
                        </div>
                        <footer>
                          <p>{branch.outcome}</p>
                          <button
                            className="secondary-button"
                            type="button"
                            disabled={!draft.chapterId}
                            title={draft.chapterId ? "把这条走向存为该章节的故事分支" : "先关联章节才能落回分支"}
                            onClick={() => void adoptBranch(branch)}
                          >
                            <GitBranch size={14} />
                            存为故事分支
                          </button>
                        </footer>
                      </article>
                    ))}
                    {!latestRun.branches.length ? <div className="empty-list-hint">这次推演没有产生走向。</div> : null}
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div className="library-empty">选择或新建一个推演场景。</div>
          )}
        </div>
      </div>
    </section>
  );
};
