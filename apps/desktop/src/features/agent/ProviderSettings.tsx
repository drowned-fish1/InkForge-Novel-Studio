import { useEffect, useState, type FormEvent } from "react";
import { Check, KeyRound, X } from "lucide-react";
import { defaultProviderConfig } from "@inkforge/schemas";
import {
  providerRoles,
  type ProviderConfigInput,
  type ProviderEndpointConfig,
  type ProviderRole,
  type ProviderStatus
} from "@inkforge/ai-provider";
import type { ProviderPreset, ProviderProbeResult } from "../../../electron/types";
import { bridge } from "@/lib/browserBridge";
import { useProviderStore } from "@/stores/useProviderStore";

const labels: Record<ProviderRole | "default", string> = {
  default: "默认连接",
  writer: "正文写手",
  planner: "故事规划",
  reviewer: "审阅编辑",
  agent: "工具 Agent"
};
const descriptions: Record<ProviderRole | "default", string> = {
  default: "未单独配置的用途使用此连接。",
  writer: "续写、扩写、改写、对白、动作和润色。可连接专用 9B 模型。",
  planner: "大纲规划、摘要、人物状态和剧情推演。",
  reviewer: "连续性与质量检查，以及创作组的审阅编辑。",
  agent: "助手聊天与需要查询资料、生成修改提案的工具调用。"
};

const draftFromStatus = (status?: ProviderStatus): ProviderConfigInput => {
  const endpoint = (value: ProviderEndpointConfig): ProviderEndpointConfig => ({
    providerId: value.providerId,
    displayName: value.displayName,
    baseUrl: value.baseUrl,
    model: value.model,
    authMode: value.authMode,
    apiKey: "",
    temperature: value.temperature ?? defaultProviderConfig.temperature,
    maxTokens: value.maxTokens ?? defaultProviderConfig.maxTokens,
    supportsTools: value.supportsTools,
    inputPricePerMillion: value.inputPricePerMillion,
    outputPricePerMillion: value.outputPricePerMillion,
    contextWindow: value.contextWindow,
    stop: value.stop,
    modelRevision: value.modelRevision,
    tokenizerRevision: value.tokenizerRevision,
    chatTemplateRevision: value.chatTemplateRevision
  });
  return {
    ...endpoint(status ?? defaultProviderConfig),
    editorModel: status?.editorModel ?? "",
    taskProviders: Object.fromEntries(
      providerRoles
        .filter((role) => status?.taskProviders?.[role])
        .map((role) => [role, endpoint(status!.taskProviders![role]!)])
    )
  };
};

export const ProviderSettings = ({ onClose }: { onClose: () => void }) => {
  const status = useProviderStore((state) => state.providerStatus);
  const save = useProviderStore((state) => state.saveProviderConfig);
  const [draft, setDraft] = useState(() => draftFromStatus(status));
  const [role, setRole] = useState<ProviderRole | "default">("default");
  const [presets, setPresets] = useState<ProviderPreset[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [probe, setProbe] = useState<ProviderProbeResult>();
  useEffect(() => {
    setDraft(draftFromStatus(status));
  }, [status]);
  useEffect(() => {
    void bridge
      .listProviderPresets()
      .then(setPresets)
      .catch(() => undefined);
  }, []);

  const enabled = role === "default" || Boolean(draft.taskProviders?.[role]);
  const current = role === "default" ? draft : (draft.taskProviders?.[role] ?? draft);
  const currentStatus = role === "default" ? status : status?.taskProviders?.[role];
  const update = (patch: Partial<ProviderEndpointConfig>) => {
    setProbe(undefined);
    setNotice("");
    setDraft((value) =>
      role === "default"
        ? { ...value, ...patch }
        : {
            ...value,
            taskProviders: { ...value.taskProviders, [role]: { ...value.taskProviders![role]!, ...patch } }
          }
    );
  };
  const toggle = (checked: boolean) => {
    if (role === "default") return;
    setProbe(undefined);
    setNotice("");
    setDraft((value) => {
      const taskProviders = { ...value.taskProviders };
      if (checked)
        taskProviders[role] = {
          ...defaultProviderConfig,
          displayName: labels[role],
          apiKey: "",
          supportsTools: role === "agent"
        };
      else delete taskProviders[role];
      return { ...value, taskProviders };
    });
  };
  const persist = async (inspect = false) => {
    setBusy(true);
    setError("");
    setNotice("");
    setProbe(undefined);
    try {
      await save(draft);
      setNotice("所有用途的配置已保存。");
      if (inspect) setProbe(await bridge.probeProvider(role === "default" ? undefined : role));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "模型配置保存失败。");
    } finally {
      setBusy(false);
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void persist();
  };
  return (
    <form className="agent-provider-settings" onSubmit={submit} aria-label="模型连接设置">
      <div className="agent-settings-title">
        <span>
          <KeyRound size={14} />
          模型连接
        </span>
        <button type="button" disabled={busy} onClick={onClose} aria-label="关闭设置">
          <X size={15} />
        </button>
      </div>
      <fieldset disabled={busy} className="provider-fields">
        <label>
          模型用途
          <select
            value={role}
            onChange={(event) => {
              setRole(event.target.value as typeof role);
              setProbe(undefined);
              setNotice("");
            }}
          >
            {["default", ...providerRoles].map((value) => (
              <option key={value} value={value}>
                {labels[value as typeof role]}
              </option>
            ))}
          </select>
        </label>
        <p className="provider-help">{descriptions[role]}</p>
        {role !== "default" ? (
          <label className="provider-toggle">
            <input type="checkbox" checked={enabled} onChange={(event) => toggle(event.target.checked)} />
            单独配置此用途
          </label>
        ) : null}
        {!enabled ? (
          <p className="provider-help">
            当前继承默认连接：{draft.displayName} ·{" "}
            {role === "reviewer" && draft.editorModel ? draft.editorModel : draft.model}
          </p>
        ) : (
          <>
            <label>
              连接预设
              <select
                value=""
                onChange={(event) => {
                  const preset = presets.find((item) => item.id === event.target.value);
                  if (preset)
                    update({
                      providerId: preset.id,
                      displayName: preset.displayName,
                      baseUrl: preset.baseUrl,
                      model: preset.model,
                      authMode: preset.authMode,
                      apiKey: "",
                      supportsTools: preset.expectedCapabilities.tools
                    });
                }}
              >
                <option value="">选择预设以填写地址和模型</option>
                {presets.map((preset) => (
                  <option value={preset.id} key={preset.id}>
                    {preset.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              连接名称
              <input
                required
                value={current.displayName}
                onChange={(event) => update({ displayName: event.target.value })}
              />
            </label>
            <label>
              Base URL
              <input
                required
                type="url"
                value={current.baseUrl}
                onChange={(event) => update({ baseUrl: event.target.value })}
              />
            </label>
            <label>
              模型
              <input required value={current.model} onChange={(event) => update({ model: event.target.value })} />
            </label>
            {role === "default" ? (
              <label>
                同地址编辑模型（可选）
                <input
                  value={draft.editorModel ?? ""}
                  placeholder="不同地址请单独配置审阅编辑"
                  onChange={(event) => setDraft({ ...draft, editorModel: event.target.value })}
                />
              </label>
            ) : null}
            <div className="agent-provider-grid">
              <label>
                鉴权
                <select
                  value={current.authMode}
                  onChange={(event) => update({ authMode: event.target.value as ProviderEndpointConfig["authMode"] })}
                >
                  <option value="bearer">Bearer</option>
                  <option value="x-api-key">x-api-key</option>
                  <option value="raw-authorization">Authorization</option>
                  <option value="none">无 Key</option>
                </select>
              </label>
              <label>
                API Key
                <input
                  type="password"
                  autoComplete="new-password"
                  disabled={current.authMode === "none"}
                  value={current.apiKey ?? ""}
                  placeholder={currentStatus?.maskedKey ?? "输入 Key"}
                  onChange={(event) => update({ apiKey: event.target.value })}
                />
              </label>
              <label>
                Temperature
                <input
                  type="number"
                  required
                  min="0"
                  max="2"
                  step="0.01"
                  value={current.temperature}
                  onChange={(event) => update({ temperature: Number(event.target.value) })}
                />
              </label>
              <label>
                最大输出 Token
                <input
                  type="number"
                  required
                  min="1"
                  max="32768"
                  step="1"
                  value={current.maxTokens}
                  onChange={(event) => update({ maxTokens: Number(event.target.value) })}
                />
              </label>
              <label>
                输入价格 / 1M tok
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={current.inputPricePerMillion ?? ""}
                  onChange={(event) =>
                    update({ inputPricePerMillion: event.target.value === "" ? undefined : Number(event.target.value) })
                  }
                />
              </label>
              <label>
                输出价格 / 1M tok
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={current.outputPricePerMillion ?? ""}
                  onChange={(event) =>
                    update({
                      outputPricePerMillion: event.target.value === "" ? undefined : Number(event.target.value)
                    })
                  }
                />
              </label>
            </div>
            <details className="provider-help">
              <summary>部署协议与输入窗口</summary>
              <label>
                上下文窗口（输入＋输出）
                <input
                  type="number"
                  min={256}
                  max={2000000}
                  value={current.contextWindow ?? ""}
                  onChange={(event) =>
                    update({ contextWindow: event.target.value ? Number(event.target.value) : undefined })
                  }
                />
              </label>
              <label>
                停止字符串（每行一个，最多四个）
                <textarea
                  value={current.stop?.join("\n") ?? ""}
                  onChange={(event) =>
                    update({ stop: event.target.value ? event.target.value.split("\n").filter(Boolean) : undefined })
                  }
                />
              </label>
              <label>
                模型版本
                <input
                  value={current.modelRevision ?? ""}
                  onChange={(event) => update({ modelRevision: event.target.value })}
                />
              </label>
              <label>
                Tokenizer 版本
                <input
                  value={current.tokenizerRevision ?? ""}
                  onChange={(event) => update({ tokenizerRevision: event.target.value })}
                />
              </label>
              <label>
                聊天模板版本
                <input
                  value={current.chatTemplateRevision ?? ""}
                  onChange={(event) => update({ chatTemplateRevision: event.target.value })}
                />
              </label>
              <p>窗口检查使用 CJK 估算并预留模板开销。实际模板、分词器和结束符仍须在部署端核对。</p>
            </details>
            <label className="provider-toggle">
              <input
                type="checkbox"
                checked={current.supportsTools !== false}
                onChange={(event) => update({ supportsTools: event.target.checked })}
              />
              允许工具调用
            </label>
            <p className="provider-help">Key 留空可保留同一连接的已存密钥。更换地址或鉴权方式后需重新填写。</p>
          </>
        )}
      </fieldset>
      {error ? (
        <p className="provider-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="provider-help" role="status">
          {notice}
        </p>
      ) : null}
      {probe ? (
        <p className={probe.ok ? "provider-help" : "provider-error"} role="status">
          {labels[role]} · {probe.model}：{probe.message}（{probe.latencyMs} ms）
        </p>
      ) : null}
      <div className="provider-actions">
        <button className="agent-save-provider" type="submit" disabled={busy}>
          <Check size={15} />
          {busy ? "处理中…" : "保存全部配置"}
        </button>
        <button className="agent-save-provider" type="button" disabled={busy} onClick={() => void persist(true)}>
          保存并探测当前用途
        </button>
      </div>
    </form>
  );
};
