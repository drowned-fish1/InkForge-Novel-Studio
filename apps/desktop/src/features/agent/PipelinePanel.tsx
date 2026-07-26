import { Check, CirclePause, CirclePlay, OctagonX, Play, RefreshCw, SkipForward, Workflow } from "lucide-react";
import { useEffect } from "react";
import { usePipelineStore } from "@/stores/usePipelineStore";
import { useProjectStore } from "@/stores/useProjectStore";
import type { PipelineStepView } from "@/types/app";
import { MarkdownContent } from "@/components/MarkdownContent";

const statusLabels: Record<string, string> = {
  idle: "待命",
  running: "运行中",
  paused: "等待作者",
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
  const skipPipelineStep = usePipelineStore((state) => state.skipPipelineStep);
  const retryPipelineStep = usePipelineStore((state) => state.retryPipelineStep);

  useEffect(() => {
    void loadPresets();
  }, [loadPresets]);

  const selectedPreset = presets.find((preset) => preset.id === selectedPresetId);
  const steps: PipelineStepView[] =
    run?.steps ?? selectedPreset?.steps.map((step) => ({ ...step, status: "pending" as const })) ?? [];
  const activeIndex = steps.findIndex((step) => step.status === "running" || step.status === "paused");
  const literaryOutputs = [
    ["roughDraft", "情节粗稿"],
    ["sensoryDraft", "感官精修稿"],
    ["editorDraft", "编辑终稿"]
  ] as const;

  return (
    <section className="agent-workflow-panel" data-testid="pipeline-panel">
      <div className="agent-workflow-heading">
        <span>
          <Workflow size={14} />多 Agent 工作流
        </span>
        <b>{statusLabels[run?.status ?? "idle"]}</b>
      </div>

      <select
        aria-label="选择多 Agent 工作流"
        value={selectedPresetId}
        disabled={running}
        onChange={(event) => selectPreset(event.target.value)}
      >
        {presets.map((preset) => (
          <option key={preset.id} value={preset.id}>
            {preset.name}
          </option>
        ))}
      </select>

      {selectedPreset ? <p>{selectedPreset.description}</p> : null}

      <div className="agent-workflow-steps">
        {steps.map((step, index) => (
          <div className={`agent-workflow-step ${step.status}`} key={step.id}>
            <i>{step.status === "completed" ? <Check size={11} /> : index + 1}</i>
            <span>
              <strong>{step.title}</strong>
              <small>{step.outputSummary || statusLabels[step.status] || step.status}</small>
            </span>
          </div>
        ))}
      </div>

      {literaryOutputs.some(([key]) => typeof run?.outputs[key] === "string") ? (
        <div className="agent-workflow-drafts">
          {literaryOutputs.map(([key, label]) =>
            typeof run?.outputs[key] === "string" ? (
              <details key={key}>
                <summary>{label}</summary>
                <MarkdownContent content={run.outputs[key] as string} />
              </details>
            ) : null
          )}
        </div>
      ) : null}

      <div className="agent-workflow-actions">
        {!run || ["completed", "cancelled"].includes(run.status) ? (
          <button type="button" disabled={running || !project || !current} onClick={() => void startPipeline()}>
            <Play size={13} />
            启动
          </button>
        ) : null}
        {run?.status === "paused" ? (
          <>
            <button className="primary" type="button" onClick={() => void confirmPipelineStep()}>
              <CirclePlay size={13} />
              执行下一阶段
            </button>
            <button type="button" onClick={() => void skipPipelineStep()}>
              <SkipForward size={13} />
              跳过
            </button>
          </>
        ) : null}
        {run?.status === "failed" ? (
          <button className="primary" type="button" onClick={() => void retryPipelineStep()}>
            <RefreshCw size={13} />
            重试失败阶段
          </button>
        ) : null}
        {run?.status === "running" ? (
          <button type="button" onClick={() => void pausePipeline()}>
            <CirclePause size={13} />
            暂停
          </button>
        ) : null}
        {run && !["completed", "cancelled", "failed"].includes(run.status) ? (
          <button type="button" onClick={() => void cancelPipeline()}>
            <OctagonX size={13} />
            取消
          </button>
        ) : null}
      </div>

      {activeIndex >= 0 ? (
        <div className="agent-workflow-checkpoint">
          作者检查点：阶段 {activeIndex + 1} / {steps.length}
        </div>
      ) : null}
      {error ? <div className="agent-error">{error}</div> : null}
    </section>
  );
};
