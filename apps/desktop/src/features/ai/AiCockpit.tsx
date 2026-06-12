import {
  Bot,
  CheckCircle2,
  ClipboardCheck,
  FileSearch,
  KeyRound,
  MessageSquarePlus,
  RefreshCw,
  RotateCcw,
  Save,
  SearchCheck,
  ShieldCheck,
  Sparkles,
  StopCircle,
  Wand2
} from "lucide-react";
import { defaultProviderConfig } from "@inkforge/schemas";
import { FormEvent, MouseEvent, useEffect, useMemo, useState } from "react";
import { PipelinePanel } from "@/features/agent/PipelinePanel";
import { WritingSessionPanel } from "@/features/agent/WritingSessionPanel";
import type { AiTaskInput, ProviderAuthMode, ProviderConfigInput } from "@/types/app";
import { useAiStore } from "@/stores/useAiStore";
import { useLibraryStore } from "@/stores/useLibraryStore";
import { useProjectStore } from "@/stores/useProjectStore";
import { useProviderStore } from "@/stores/useProviderStore";

type TaskMode = "writing" | "structure" | "canon" | "delivery";

const actionGroups: Record<
  TaskMode,
  {
    label: string;
    items: Array<[AiTaskInput["task"], string, string, typeof Sparkles]>;
  }
> = {
  writing: {
    label: "写作辅助",
    items: [
      ["continue", "续写", "顺着当前段落继续推进正文", Sparkles],
      ["expand", "扩写", "把薄段落加厚，补感官和压力", Wand2],
      ["rewrite", "改写", "保留事实，换更顺的表达", RefreshCw],
      ["dialogue", "补对白", "补人物口吻和交锋节奏", MessageSquarePlus],
      ["action", "补动作", "补动作链、走位和场面推进", RotateCcw]
    ]
  },
  structure: {
    label: "结构辅助",
    items: [
      ["summary", "总结本章", "生成摘要、状态变化和沉淀点", ClipboardCheck],
      ["next-goal", "下一章目标", "根据收尾生成下一章目标", Sparkles],
      ["pacing", "检查节奏", "检查信息量、爽点和钩子密度", FileSearch]
    ]
  },
  canon: {
    label: "设定辅助",
    items: [
      ["character-state", "人物状态", "核对人物动机、位置、关系", CheckCircle2],
      ["clue-check", "检查伏笔", "核对埋设、推进和回收状态", SearchCheck],
      ["term-check", "检查术语", "核对境界、术语和固定称谓", FileSearch],
      ["ai-inspect", "AI 深度检查", "用 AI 检查人物矛盾、时间线、战力、伏笔和术语冲突", ShieldCheck]
    ]
  },
  delivery: {
    label: "出稿辅助",
    items: [
      ["polish", "章节润色", "清理废话并强化可读性", RotateCcw],
      ["typo", "错别字检查", "检查错字、病句和标点", SearchCheck],
      ["pre-export", "导出前检查", "检查标题、空段和结构问题", ClipboardCheck]
    ]
  }
};

const authLabels: Record<ProviderAuthMode, string> = {
  bearer: "Bearer Token",
  "x-api-key": "x-api-key",
  "raw-authorization": "原样 Authorization",
  none: "无 Key"
};

export const AiCockpit = () => {
  const current = useProjectStore((state) => state.current);
  const characters = useLibraryStore((state) => state.characters);
  const worldEntries = useLibraryStore((state) => state.worldEntries);
  const clues = useLibraryStore((state) => state.clues);
  const terms = useLibraryStore((state) => state.terms);
  const providerStatus = useProviderStore((state) => state.providerStatus);
  const saveProviderConfig = useProviderStore((state) => state.saveProviderConfig);
  const runAiTask = useAiStore((state) => state.runAiTask);
  const cancelAiTask = useAiStore((state) => state.cancelAiTask);
  const appendDraftToChapter = useAiStore((state) => state.appendDraftToChapter);
  const saveDraftAsSummary = useAiStore((state) => state.saveDraftAsSummary);
  const removeDraft = useAiStore((state) => state.removeDraft);
  const followUpDraft = useAiStore((state) => state.followUpDraft);
  const clearAllDrafts = useAiStore((state) => state.clearAllDrafts);
  const aiDrafts = useAiStore((state) => state.aiDrafts);
  const aiRunning = useAiStore((state) => state.aiRunning);
  const sessionTokens = useAiStore((state) => state.sessionTokens);
  const lastSummaryPath = useAiStore((state) => state.lastSummaryPath);
  const error = useProjectStore((state) => state.error);
  const [taskMode, setTaskMode] = useState<TaskMode>("writing");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draftConfig, setDraftConfig] = useState<ProviderConfigInput>({
    providerId: providerStatus?.providerId ?? defaultProviderConfig.providerId,
    displayName: providerStatus?.displayName ?? defaultProviderConfig.displayName,
    baseUrl: providerStatus?.baseUrl ?? defaultProviderConfig.baseUrl,
    model: providerStatus?.model ?? defaultProviderConfig.model,
    authMode: providerStatus?.authMode ?? defaultProviderConfig.authMode,
    apiKey: "",
    temperature: defaultProviderConfig.temperature,
    maxTokens: defaultProviderConfig.maxTokens
  });

  useEffect(() => {
    if (!providerStatus) {
      return;
    }
    setDraftConfig((current) => ({
      ...current,
      providerId: providerStatus.providerId,
      displayName: providerStatus.displayName,
      baseUrl: providerStatus.baseUrl,
      model: providerStatus.model,
      authMode: providerStatus.authMode,
      apiKey: ""
    }));
  }, [providerStatus]);

  useEffect(() => {
    const closeSettings = (event: Event) => {
      if (!settingsOpen) {
        return;
      }
      setSettingsOpen(false);
      event.preventDefault();
    };
    window.addEventListener("inkforge:close-settings", closeSettings);
    return () => window.removeEventListener("inkforge:close-settings", closeSettings);
  }, [settingsOpen]);

  const quickRefs = useMemo(() => {
    const plannedCharacters = current?.plan.characters ?? [];
    const characterRefs = plannedCharacters.length
      ? characters.filter((item) => plannedCharacters.includes(item.name) || plannedCharacters.includes(item.id))
      : characters.slice(0, 4);
    const plannedWorld = current?.plan.worldRefs ?? [];
    const worldRefs = plannedWorld.length
      ? worldEntries.filter((item) => plannedWorld.includes(item.title) || plannedWorld.includes(item.id))
      : worldEntries.slice(0, 4);
    const clueRefs = clues
      .filter(
        (item) =>
          item.plantedChapterId === current?.plan.id ||
          item.relatedCharacters.some((name) => plannedCharacters.includes(name))
      )
      .slice(0, 4);
    const termRefs = terms
      .filter((item) => plannedWorld.some((ref) => item.name.includes(ref) || item.aliases.includes(ref)))
      .slice(0, 4);
    return { characterRefs, worldRefs, clueRefs, termRefs };
  }, [characters, clues, current?.plan.characters, current?.plan.id, current?.plan.worldRefs, terms, worldEntries]);

  const collectProviderConfig = (formElement: HTMLFormElement): ProviderConfigInput => {
    const form = new FormData(formElement);
    return {
      providerId: defaultProviderConfig.providerId,
      displayName: String(form.get("displayName") ?? draftConfig.displayName),
      baseUrl: String(form.get("baseUrl") ?? draftConfig.baseUrl),
      model: String(form.get("model") ?? draftConfig.model),
      authMode: String(form.get("authMode") ?? draftConfig.authMode) as ProviderAuthMode,
      apiKey: String(form.get("apiKey") ?? ""),
      temperature: Number(form.get("temperature") ?? draftConfig.temperature),
      maxTokens: Number(form.get("maxTokens") ?? draftConfig.maxTokens)
    };
  };

  const persistProviderConfig = (nextConfig: ProviderConfigInput) => {
    setDraftConfig(nextConfig);
    void saveProviderConfig(nextConfig).then(() => setSettingsOpen(false));
  };

  const submitProvider = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    persistProviderConfig(collectProviderConfig(event.currentTarget));
  };

  const clickSaveProvider = (event: MouseEvent<HTMLButtonElement>) => {
    const formElement = event.currentTarget.form;
    if (formElement) {
      persistProviderConfig(collectProviderConfig(formElement));
    }
  };

  return (
    <aside className="ai-cockpit">
      <PipelinePanel />
      <WritingSessionPanel />

      <section className="cockpit-section provider-card">
        <div className="section-heading">
          <span>AI 任务面板</span>
          <Bot size={16} />
        </div>
        <div className="provider-state">
          <span className={providerStatus?.configured ? "dot ok" : "dot warn"} />
          <span>{providerStatus?.configured ? providerStatus.model : "Provider 未配置"}</span>
        </div>
        {providerStatus ? (
          <div className="provider-detail">
            {providerStatus.displayName} / {authLabels[providerStatus.authMode]}
            {providerStatus.maskedKey ? ` / ${providerStatus.maskedKey}` : ""}
          </div>
        ) : null}
        <button className="secondary-button full" type="button" onClick={() => setSettingsOpen((value) => !value)}>
          <KeyRound size={16} />
          Provider 设置
        </button>
      </section>

      {settingsOpen ? (
        <form className="cockpit-section provider-form" onSubmit={submitProvider}>
          <label>
            名称
            <input
              name="displayName"
              autoComplete="username"
              value={draftConfig.displayName}
              onChange={(event) => setDraftConfig({ ...draftConfig, displayName: event.target.value })}
            />
          </label>
          <label>
            Base URL
            <input
              name="baseUrl"
              value={draftConfig.baseUrl}
              placeholder={defaultProviderConfig.baseUrl}
              onChange={(event) => setDraftConfig({ ...draftConfig, baseUrl: event.target.value })}
            />
          </label>
          <label>
            模型
            <input
              name="model"
              value={draftConfig.model}
              placeholder={`${defaultProviderConfig.model} / deepseek-chat / ...`}
              onChange={(event) => setDraftConfig({ ...draftConfig, model: event.target.value })}
            />
          </label>
          <label>
            Key 格式
            <select
              name="authMode"
              value={draftConfig.authMode}
              onChange={(event) => setDraftConfig({ ...draftConfig, authMode: event.target.value as ProviderAuthMode })}
            >
              <option value="bearer">Bearer Token</option>
              <option value="x-api-key">x-api-key</option>
              <option value="raw-authorization">原样 Authorization</option>
              <option value="none">无 Key</option>
            </select>
          </label>
          {draftConfig.authMode !== "none" ? (
            <label>
              API Key
              <input
                name="apiKey"
                type="password"
                autoComplete="current-password"
                value={draftConfig.apiKey}
                placeholder={providerStatus?.maskedKey ? "留空表示继续使用已保存 Key" : "粘贴你的 API Key"}
                onChange={(event) => setDraftConfig({ ...draftConfig, apiKey: event.target.value })}
              />
            </label>
          ) : null}
          <div className="field-grid compact">
            <label>
              温度
              <input
                name="temperature"
                type="number"
                min="0"
                max="2"
                step="0.05"
                value={draftConfig.temperature}
                onChange={(event) => setDraftConfig({ ...draftConfig, temperature: Number(event.target.value) })}
              />
            </label>
            <label>
              最大 Token
              <input
                name="maxTokens"
                type="number"
                min="128"
                max="16000"
                step="128"
                value={draftConfig.maxTokens}
                onChange={(event) => setDraftConfig({ ...draftConfig, maxTokens: Number(event.target.value) })}
              />
            </label>
          </div>
          <button className="primary-button full" type="button" onClick={clickSaveProvider}>
            <Save size={16} />
            保存配置
          </button>
        </form>
      ) : null}

      <section className="cockpit-section task-panel">
        <div className="task-tabs">
          {(Object.entries(actionGroups) as Array<[TaskMode, (typeof actionGroups)[TaskMode]]>).map(([id, group]) => (
            <button key={id} type="button" className={taskMode === id ? "active" : ""} onClick={() => setTaskMode(id)}>
              {group.label}
            </button>
          ))}
        </div>
        <div className="action-grid">
          {actionGroups[taskMode].items.map(([task, label, hint, Icon]) => (
            <button type="button" key={task} disabled={aiRunning} onClick={() => void runAiTask(task)}>
              <Icon size={17} />
              <strong>{aiRunning ? "生成中" : label}</strong>
              <span>{hint}</span>
            </button>
          ))}
        </div>
        {aiRunning ? (
          <button className="secondary-button full cancel-button" type="button" onClick={cancelAiTask}>
            <StopCircle size={16} />
            取消生成
          </button>
        ) : null}
      </section>

      <section className="cockpit-section">
        <div className="section-heading">
          <span>本章相关资料</span>
          <CheckCircle2 size={16} />
        </div>
        <div className="reference-groups">
          {quickRefs.characterRefs.map((item) => (
            <span key={item.id}>
              <strong>{item.name}</strong>
              {item.currentState.location ||
                item.currentState.powerLevel ||
                item.profile.identity ||
                item.role ||
                "人物卡"}
            </span>
          ))}
          {quickRefs.worldRefs.map((item) => (
            <span className="amber" key={item.id}>
              <strong>{item.title}</strong>
              {item.summary || item.type}
            </span>
          ))}
          {quickRefs.clueRefs.map((item) => (
            <span className="blue" key={item.id}>
              <strong>{item.title}</strong>
              {item.status}
            </span>
          ))}
          {quickRefs.termRefs.map((item) => (
            <span className="amber" key={item.id}>
              <strong>{item.name}</strong>
              {item.category}
            </span>
          ))}
          {quickRefs.characterRefs.length +
            quickRefs.worldRefs.length +
            quickRefs.clueRefs.length +
            quickRefs.termRefs.length ===
          0 ? (
            <span>暂无本章关联资料</span>
          ) : null}
        </div>
      </section>

      <section className="cockpit-section draft-box">
        <div className="section-heading">
          <span>草稿区</span>
          <span className="muted">
            {aiDrafts.length > 0 ? `${aiDrafts.length} 条` : "需确认"}
            {sessionTokens > 0 ? ` · ~${sessionTokens.toLocaleString()} tokens` : ""}
          </span>
          {aiDrafts.length > 1 ? (
            <button className="tiny-text-button" type="button" onClick={clearAllDrafts}>
              清空全部
            </button>
          ) : null}
        </div>
        {error ? <div className="error-banner compact">{error}</div> : null}
        {lastSummaryPath ? <div className="success-banner compact">已保存总结：{lastSummaryPath}</div> : null}
        {aiDrafts.length === 0 ? (
          <pre>AI 输出会先停在这里，不会直接覆盖正文。</pre>
        ) : (
          <div className="draft-list">
            {aiDrafts.map((entry) => (
              <div
                className={`draft-item ${entry.appended ? "appended" : ""} ${entry.savedAsSummaryPath ? "saved" : ""}`}
                key={entry.id}
              >
                <div className="draft-meta">
                  <span className="draft-task">{entry.result.task}</span>
                  <span className="draft-model">{entry.result.model}</span>
                  <span className="draft-time">{new Date(entry.result.generatedAt).toLocaleString()}</span>
                  {entry.streaming ? <span className="draft-badge streaming">生成中</span> : null}
                  {entry.appended ? <span className="draft-badge ok">已追加</span> : null}
                  {entry.savedAsSummaryPath ? <span className="draft-badge saved">已存总结</span> : null}
                </div>
                <pre className="draft-text">{entry.result.text || (entry.streaming ? "正在等待模型输出..." : "")}</pre>
                <div className="draft-actions">
                  {!entry.appended && !entry.streaming ? (
                    <button
                      className="secondary-button compact"
                      type="button"
                      onClick={() => void appendDraftToChapter(entry.id)}
                    >
                      追加到章末
                    </button>
                  ) : null}
                  {!entry.savedAsSummaryPath && !entry.streaming ? (
                    <button
                      className="secondary-button compact"
                      type="button"
                      onClick={() => void saveDraftAsSummary(entry.id)}
                    >
                      保存为总结
                    </button>
                  ) : null}
                  <button className="tiny-text-button" type="button" onClick={() => removeDraft(entry.id)}>
                    删除
                  </button>
                </div>
                {!entry.appended && !entry.streaming ? (
                  <FollowUpInput draftId={entry.id} disabled={aiRunning} onSend={followUpDraft} />
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>
    </aside>
  );
};

const FollowUpInput = ({
  draftId,
  disabled,
  onSend
}: {
  draftId: string;
  disabled: boolean;
  onSend: (draftId: string, instruction: string) => Promise<void>;
}) => {
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    setSending(true);
    void onSend(draftId, trimmed).then(() => {
      setValue("");
      setSending(false);
    });
  };

  return (
    <div className="follow-up-row">
      <input
        className="follow-up-input"
        type="text"
        placeholder="追加指令，如：更紧凑一点 / 加强对话 / 修改结局"
        value={value}
        disabled={disabled || sending}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
      />
      <button
        className="tiny-text-button"
        type="button"
        disabled={disabled || sending || !value.trim()}
        onClick={submit}
      >
        {sending ? "…" : "发送"}
      </button>
    </div>
  );
};
