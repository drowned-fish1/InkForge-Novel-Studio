import { Check, History, Pause, Play, RotateCcw, Save, Square } from "lucide-react";
import { useMemo, useState } from "react";
import { useWritingSessionStore } from "@/stores/useWritingSessionStore";

const statusLabels: Record<string, string> = {
  planning: "规划中",
  writing: "写作中",
  paused: "已暂停",
  awaiting_decision: "等待决策",
  review: "自检中",
  done: "完成"
};

const mockNotice = "演示 / Mock：自主写作当前只生成本地模拟草稿，不调用真实 AI provider 或生产链路。";

export const WritingSessionPanel = () => {
  const scenePlans = useWritingSessionStore((state) => state.scenePlans);
  const session = useWritingSessionStore((state) => state.session);
  const running = useWritingSessionStore((state) => state.running);
  const error = useWritingSessionStore((state) => state.error);
  const startSession = useWritingSessionStore((state) => state.startSession);
  const pauseSession = useWritingSessionStore((state) => state.pauseSession);
  const resumeSession = useWritingSessionStore((state) => state.resumeSession);
  const stopSession = useWritingSessionStore((state) => state.stopSession);
  const createCheckpoint = useWritingSessionStore((state) => state.createCheckpoint);
  const rollbackCheckpoint = useWritingSessionStore((state) => state.rollbackCheckpoint);
  const resolveDecision = useWritingSessionStore((state) => state.resolveDecision);
  const metrics = useWritingSessionStore((state) => state.metrics);
  const [decision, setDecision] = useState("继续当前方向，并强化场景目标");

  const currentSceneNumber = Math.min(
    (session?.currentSceneIndex ?? 0) + 1,
    Math.max(1, session?.scenes.length ?? scenePlans.length)
  );
  const totalScenes = Math.max(1, session?.scenes.length ?? scenePlans.length);
  const progress = Math.round(((session?.currentSceneIndex ?? 0) / totalScenes) * 100);
  const currentMetrics = metrics();
  const latestDraft = session?.drafts.at(-1);
  const decisionOpen = session?.status === "awaiting_decision";

  const checkpointRows = useMemo(() => [...(session?.checkpoints ?? [])].reverse(), [session?.checkpoints]);

  return (
    <section className="cockpit-section writing-session-panel" data-testid="writing-session-panel">
      <div className="section-heading">
        <span>自主写作</span>
        <span className={`session-status ${session?.status ?? "planning"}`}>
          {statusLabels[session?.status ?? "planning"]} · 演示
        </span>
      </div>

      <p className="panel-hint">{mockNotice}</p>

      <div className="session-progress">
        <div>
          <strong>
            场景 {currentSceneNumber}/{totalScenes}
          </strong>
          <span>
            {currentMetrics.words.toLocaleString("zh-CN")} 字 · ~{currentMetrics.tokens.toLocaleString("zh-CN")} token
          </span>
        </div>
        <div className="progress-track">
          <div style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="session-actions">
        <button
          className="primary-button compact"
          type="button"
          disabled={running || scenePlans.length === 0}
          onClick={() => void startSession()}
        >
          <Play size={15} />
          开始演示
        </button>
        <button
          className="secondary-button compact"
          type="button"
          disabled={!session || session.status !== "writing"}
          onClick={() => void pauseSession()}
        >
          <Pause size={15} />
          暂停演示
        </button>
        <button
          className="secondary-button compact"
          type="button"
          disabled={!session || !["paused", "awaiting_decision"].includes(session.status)}
          onClick={() => void resumeSession()}
        >
          <RotateCcw size={15} />
          继续演示
        </button>
        <button
          className="secondary-button compact"
          type="button"
          disabled={!session || session.status === "done"}
          onClick={() => void stopSession()}
        >
          <Square size={15} />
          停止演示
        </button>
      </div>

      {latestDraft ? (
        <div className="session-draft-preview">
          <strong>{latestDraft.sceneId}</strong>
          <p>{latestDraft.text}</p>
        </div>
      ) : (
        <p className="panel-hint">场景卡片准备好后，可以启动自主写作演示 / Mock loop。</p>
      )}

      <div className="checkpoint-header">
        <span>
          <History size={14} /> 检查点
        </span>
        <button className="tiny-text-button" type="button" disabled={!session} onClick={() => void createCheckpoint()}>
          <Save size={14} />
          保存演示点
        </button>
      </div>
      <div className="checkpoint-list">
        {checkpointRows.length ? (
          checkpointRows.map((checkpoint) => (
            <button key={checkpoint.id} type="button" onClick={() => void rollbackCheckpoint(checkpoint.id)}>
              <strong>{checkpoint.label}</strong>
              <span>{new Date(checkpoint.createdAt).toLocaleTimeString("zh-CN")}</span>
            </button>
          ))
        ) : (
          <span className="muted">暂无检查点</span>
        )}
      </div>

      {error ? <div className="error-banner compact">{error}</div> : null}

      {decisionOpen ? (
        <div className="decision-backdrop" role="dialog" aria-modal="true" aria-label="写作决策">
          <div className="decision-modal">
            <strong>需要决策</strong>
            <p>演示 / Mock 决策点：此处只会推进本地模拟草稿。</p>
            <p>{session.pendingDecision}</p>
            <textarea value={decision} onChange={(event) => setDecision(event.target.value)} />
            <button className="primary-button full" type="button" onClick={() => void resolveDecision(decision)}>
              <Check size={15} />
              确认并继续演示
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
};
