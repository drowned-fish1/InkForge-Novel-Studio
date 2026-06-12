import { CheckCircle2, CirclePause, CirclePlay, OctagonX, Play, Workflow } from "lucide-react";
import { useEffect } from "react";
import { usePipelineStore } from "@/stores/usePipelineStore";
import { useProjectStore } from "@/stores/useProjectStore";

const statusLabels: Record<string, string> = {
  idle: "待命",
  running: "运行中",
  paused: "等待确认",
  failed: "失败",
  completed: "完成",
  cancelled: "已取消",
  pending: "待执行",
  skipped: "已跳过"
};

export const PipelinePanel = () => {
  const project = useProjectStore((state) => state.project);
  const current = useProjectStore((state) => state.current);
  const presets = usePipelineStore((state) => state.presets);
  const selectedPresetId = usePipelineStore((state) => state.selectedPresetId);
  const run = usePipelineStore((state) => state.run);
  const running = usePipelineStore((state) => state.running);
  const error = usePipelineStore((state) => state.error);
  const loadPresets = usePipelineStore((state) => state.loadPresets);
  const selectPreset = usePipelineStore((state) => state.selectPreset);
  const startPipeline = usePipelineStore((state) => state.startPipeline);
  const confirmPipelineStep = usePipelineStore((state) => state.confirmPipelineStep);
  const pausePipeline = usePipelineStore((state) => state.pausePipeline);
  const cancelPipeline = usePipelineStore((state) => state.cancelPipeline);

  useEffect(() => {
    void loadPresets();
  }, [loadPresets]);

  const selectedPreset = presets.find((preset) => preset.id === selectedPresetId);
  const steps: Array<{
    id: string;
    title: string;
    status: string;
    outputSummary?: string;
  }> = run?.steps ?? selectedPreset?.steps.map((step) => ({ ...step, status: "pending" })) ?? [];
  const completed = steps.filter((step) => step.status === "completed").length;
  const completion = steps.length ? Math.round((completed / steps.length) * 100) : 0;
  const hasRealScope = Boolean(project && current);

  return (
    <section className="cockpit-section pipeline-panel" data-testid="pipeline-panel">
      <div className="section-heading">
        <span>流水线</span>
        <Workflow size={16} />
      </div>

      <p className="panel-hint">
        {hasRealScope
          ? "当前会调用已配置的 AI provider，生成草稿后停在写入确认步骤。"
          : "未打开项目章节时只运行浏览器/本地演示链路。"}
      </p>

      <label className="control-field">
        模板
        <select value={selectedPresetId} onChange={(event) => selectPreset(event.target.value)}>
          {presets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name}
            </option>
          ))}
        </select>
      </label>

      {selectedPreset ? <p className="panel-hint">{selectedPreset.description}</p> : null}

      <div className="pipeline-progress">
        <span>{statusLabels[run?.status ?? "idle"] ?? run?.status ?? "待命"}</span>
        <strong>{completion}%</strong>
        <div className="progress-track">
          <div style={{ width: `${completion}%` }} />
        </div>
      </div>

      <div className="pipeline-steps">
        {steps.map((step, index) => (
          <div className={`pipeline-step ${step.status}`} key={step.id}>
            <span>{index + 1}</span>
            <div>
              <strong>{step.title}</strong>
              <small>
                {statusLabels[step.status] ?? step.status}
                {step.outputSummary ? ` · ${step.outputSummary}` : ""}
              </small>
            </div>
          </div>
        ))}
      </div>

      <div className="pipeline-actions">
        <button
          className="primary-button compact"
          type="button"
          disabled={running}
          onClick={() => void startPipeline()}
        >
          <Play size={15} />
          执行
        </button>
        <button
          className="secondary-button compact"
          type="button"
          disabled={run?.status !== "paused"}
          onClick={() => void confirmPipelineStep()}
        >
          <CheckCircle2 size={15} />
          确认写入
        </button>
        <button
          className="secondary-button compact"
          type="button"
          disabled={!run || run.status !== "running"}
          onClick={() => void pausePipeline()}
        >
          <CirclePause size={15} />
          暂停
        </button>
        <button
          className="secondary-button compact"
          type="button"
          disabled={!run || ["completed", "cancelled", "failed"].includes(run.status)}
          onClick={() => void cancelPipeline()}
        >
          <OctagonX size={15} />
          取消
        </button>
      </div>

      <div className="pipeline-output" aria-live="polite">
        {(run?.logs.length ? run.logs : ["打开项目和章节后执行流水线；生成草稿会先等待确认，再写入章节。"]).map(
          (line, index) => (
            <code key={`${line}-${index}`}>{line}</code>
          )
        )}
      </div>

      {error ? <div className="error-banner compact">{error}</div> : null}
      {running ? (
        <div className="inline-status">
          <CirclePlay size={14} /> 正在处理流水线...
        </div>
      ) : null}
    </section>
  );
};
