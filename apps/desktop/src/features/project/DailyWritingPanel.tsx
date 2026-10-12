import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Save, Trash2 } from "lucide-react";
import { DailyWritingPlanSchema, DailyWritingTemplateSchema, type DailyWritingPlan } from "@inkforge/schemas";
import {
  dailyTemplates,
  dailyProgress,
  estimateFinishDate,
  localDayKey,
  makeDailyPlan,
  manuscriptStock
} from "@/lib/dailyWriting";
import { useWritingWorkspace } from "@/lib/useWritingWorkspace";
import { useEditorGuard } from "@/lib/useEditorGuard";
import { useProjectStore } from "@/stores/useProjectStore";

export const DailyWritingPanel = () => {
  const project = useProjectStore((state) => state.project)!;
  const { workspace, error: persistenceError, busy, mutate } = useWritingWorkspace(project.projectPath);
  const [today, setToday] = useState(localDayKey());
  const [date, setDate] = useState(today);
  const [draft, setDraft] = useState<DailyWritingPlan>();
  const [baseline, setBaseline] = useState("");
  const [deadline, setDeadline] = useState("");
  const [taskText, setTaskText] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const templates = useMemo(
    () => [...dailyTemplates, ...(workspace?.dailyWriting?.templates ?? [])],
    [workspace?.dailyWriting?.templates]
  );
  const initialPlan = (day: string) =>
    workspace?.dailyWriting?.plans.find((plan) => plan.date === day) ??
    makeDailyPlan(
      day,
      templates.find((template) => template.id === workspace?.dailyWriting?.activeTemplateId) ?? dailyTemplates[0]
    );
  const dirty = Boolean(draft && JSON.stringify({ draft, deadline }) !== baseline) || Boolean(taskText.trim());
  const canLeave = useEditorGuard(dirty, busy, () => void savePlan());

  useEffect(() => {
    if (!workspace || draft) return;
    const plan = initialPlan(date);
    const due = workspace.dailyWriting?.deadline ?? "";
    setDraft(plan);
    setDeadline(due);
    setBaseline(JSON.stringify({ draft: plan, deadline: due }));
  }, [workspace, draft, date]);
  useEffect(() => {
    const timer = window.setInterval(() => setToday(localDayKey()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const savePlan = async (asTemplate = false) => {
    if (!draft || !workspace || busy) return;
    setError("");
    setNotice("");
    try {
      const plan = DailyWritingPlanSchema.parse({
        ...draft,
        tasks: taskText.trim() ? [...draft.tasks, { text: taskText.trim(), done: false }] : draft.tasks
      });
      const template = asTemplate
        ? DailyWritingTemplateSchema.parse({
            id: `daily-${crypto.randomUUID()}`,
            name: templateName.trim(),
            ...plan,
            tasks: plan.tasks.map((task) => task.text)
          })
        : undefined;
      if (template && templates.some((item) => item.name === template.name))
        throw new Error("模板名称已存在，请换一个名称。");
      const nextPlan = template ? { ...plan, templateId: template.id } : plan;
      await mutate((state) => ({
        ...state,
        dailyWriting: {
          templates: [...(state.dailyWriting?.templates ?? []), ...(template ? [template] : [])],
          activeTemplateId: nextPlan.templateId,
          plans: [...(state.dailyWriting?.plans ?? []).filter((item) => item.date !== nextPlan.date), nextPlan].sort(
            (a, b) => a.date.localeCompare(b.date)
          ),
          ...(deadline ? { deadline } : {})
        }
      }));
      setDraft(nextPlan);
      setTaskText("");
      setTemplateName("");
      setBaseline(JSON.stringify({ draft: nextPlan, deadline }));
      setNotice(template ? "模板和当日计划已保存，可在其他日期复用。" : "当日计划已保存。");
    } catch (cause) {
      setError(
        cause instanceof Error && !cause.message.startsWith("[")
          ? cause.message
          : "请检查目标数值、模板名称与待办（最多 30 项）。"
      );
    }
  };
  const changeDate = (day: string) => {
    if (!day || !workspace || !canLeave()) return;
    const plan = initialPlan(day);
    const due = workspace.dailyWriting?.deadline ?? "";
    setDate(day);
    setDraft(plan);
    setDeadline(due);
    setTaskText("");
    setNotice("");
    setBaseline(JSON.stringify({ draft: plan, deadline: due }));
  };
  const deleteTemplate = async () => {
    if (!draft || !workspace || busy) return;
    try {
      await mutate((state) => ({
        ...state,
        dailyWriting: {
          templates: (state.dailyWriting?.templates ?? []).filter((item) => item.id !== draft.templateId),
          activeTemplateId:
            state.dailyWriting?.activeTemplateId === draft.templateId
              ? dailyTemplates[0].id
              : (state.dailyWriting?.activeTemplateId ?? dailyTemplates[0].id),
          plans: state.dailyWriting?.plans ?? [],
          ...(state.dailyWriting?.deadline ? { deadline: state.dailyWriting.deadline } : {})
        }
      }));
      setDraft({ ...draft, templateId: dailyTemplates[0].id });
      setNotice("模板已删除，历史每日计划保留。");
    } catch {
      /* Persistence error is shown below. */
    }
  };

  if (!workspace || !draft)
    return <div role={persistenceError ? "alert" : "status"}>{persistenceError || "正在读取每日计划…"}</div>;
  const progress = dailyProgress(workspace.sessions, date);
  const chapters = project.outline.volumes.flatMap((volume) => volume.chapters);
  const written = chapters
    .filter((chapter) => !chapter.archived)
    .reduce((sum, chapter) => sum + chapter.actualWords, 0);
  const stock = manuscriptStock(chapters, workspace.releases ?? [], draft.releaseWords);
  const finishDate = estimateFinishDate(today, project.meta.targetWords, written, draft.wordGoal);
  const selectedTemplate = templates.find((template) => template.id === draft.templateId);
  const recent = Array.from({ length: 7 }, (_, index) => {
    const day = new Date();
    day.setDate(day.getDate() - index);
    const key = localDayKey(day);
    const plan = workspace.dailyWriting?.plans.find((item) => item.date === key);
    return { key, progress: dailyProgress(workspace.sessions, key), goal: plan?.wordGoal };
  });

  return (
    <div className="daily-writing-panel writing-management">
      <header className="writing-management-heading">
        <div>
          <h3>
            <CalendarDays size={18} /> 每日写作计划
          </h3>
          <p>选择模板安排每天的目标与待办。写作字数按已结束会话的净增长统计。</p>
        </div>
        <label>
          计划日期
          <input
            aria-label="计划日期"
            type="date"
            value={date}
            onChange={(event) => changeDate(event.target.value)}
            disabled={busy}
          />
        </label>
      </header>
      {error || persistenceError ? (
        <p className="error-banner" role="alert">
          {error || persistenceError}
        </p>
      ) : null}
      <div className="writing-management-metrics">
        <article>
          <small>{date === today ? "今日" : date}净增字数</small>
          <strong>
            {progress.words.toLocaleString()} / {draft.wordGoal.toLocaleString()}
          </strong>
          <progress aria-label="每日字数进度" max={draft.wordGoal} value={Math.min(progress.words, draft.wordGoal)} />
          <span>还差 {Math.max(0, draft.wordGoal - progress.words).toLocaleString()} 字</span>
        </article>
        <article>
          <small>写作时长</small>
          <strong>
            {progress.minutes} / {draft.minuteGoal} 分钟
          </strong>
          <span>会话包含编辑页面停留时间</span>
        </article>
        <article>
          <small>存稿可供更新</small>
          <strong>{stock.days === undefined ? "未设日更量" : `${stock.days} 天`}</strong>
          <span>
            {stock.chapters} 章 · {stock.words.toLocaleString()} 字
          </span>
        </article>
        <article>
          <small>按日目标预计完稿</small>
          <strong>{finishDate}</strong>
          <span>
            {written >= project.meta.targetWords
              ? "已达全书目标"
              : `还差 ${(project.meta.targetWords - written).toLocaleString()} 字`}
            {deadline && finishDate > deadline ? " · 晚于期限" : ""}
          </span>
        </article>
      </div>
      <form
        className="daily-plan-form"
        onSubmit={(event) => {
          event.preventDefault();
          void savePlan();
        }}
      >
        <fieldset disabled={busy}>
          <div className="daily-template-toolbar">
            <label>
              使用模板
              <select
                aria-label="每日模板"
                value={selectedTemplate?.id ?? ""}
                onChange={(event) => {
                  const template = templates.find((item) => item.id === event.target.value);
                  if (template) {
                    setDraft(makeDailyPlan(date, template, draft));
                    setNotice("模板已填入，请保存当日计划。");
                  }
                }}
              >
                <option value="" disabled>
                  自定义计划
                </option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </label>
            {workspace.dailyWriting?.templates.some((template) => template.id === draft.templateId) ? (
              <button type="button" className="secondary-button" onClick={() => void deleteTemplate()}>
                <Trash2 size={14} />
                删除此模板
              </button>
            ) : null}
          </div>
          <div className="daily-goal-fields">
            <label>
              每日目标字数
              <input
                aria-label="每日目标字数"
                type="number"
                min="1"
                max="1000000"
                required
                value={draft.wordGoal}
                onChange={(event) => setDraft({ ...draft, wordGoal: Number(event.target.value) })}
              />
            </label>
            <label>
              每日目标分钟
              <input
                aria-label="每日目标分钟"
                type="number"
                min="0"
                max="1440"
                value={draft.minuteGoal}
                onChange={(event) => setDraft({ ...draft, minuteGoal: Number(event.target.value) })}
              />
            </label>
            <label>
              每日发布字数
              <input
                aria-label="每日发布字数"
                type="number"
                min="0"
                max="1000000"
                value={draft.releaseWords}
                onChange={(event) => setDraft({ ...draft, releaseWords: Number(event.target.value) })}
              />
              <small>填 0 表示暂不连载</small>
            </label>
            <label>
              全书完稿期限
              <input
                aria-label="全书完稿期限"
                type="date"
                value={deadline}
                onChange={(event) => setDeadline(event.target.value)}
              />
            </label>
          </div>
          <h4>当日待办</h4>
          <div className="daily-checklist">
            {draft.tasks.map((task, index) => (
              <div key={`${index}:${task.text}`}>
                <label>
                  <input
                    type="checkbox"
                    checked={task.done}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        tasks: draft.tasks.map((item, offset) =>
                          offset === index ? { ...item, done: event.target.checked } : item
                        )
                      })
                    }
                  />
                  <span>{task.text}</span>
                </label>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`移除待办 ${task.text}`}
                  onClick={() => setDraft({ ...draft, tasks: draft.tasks.filter((_, offset) => offset !== index) })}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
          <label>
            新增待办
            <input
              aria-label="新增每日待办"
              value={taskText}
              maxLength={500}
              placeholder="例如：检查主角在本章的选择"
              onChange={(event) => setTaskText(event.target.value)}
            />
          </label>
          <div className="daily-template-toolbar">
            <button type="submit" className="primary-button">
              <Save size={15} />
              保存当日计划
            </button>
            <input
              aria-label="新每日模板名称"
              placeholder="给当前计划取一个模板名"
              value={templateName}
              maxLength={80}
              onChange={(event) => setTemplateName(event.target.value)}
            />
            <button
              type="button"
              className="secondary-button"
              disabled={!templateName.trim()}
              onClick={() => void savePlan(true)}
            >
              另存为模板
            </button>
          </div>
        </fieldset>
      </form>
      <p className="editor-feedback" role="status">
        {busy ? "正在保存…" : dirty ? "有未保存的计划 · Ctrl+S 保存" : notice}
      </p>
      <div className="daily-recent">
        <h4>近七天记录</h4>
        {recent.map((day) => (
          <button type="button" key={day.key} onClick={() => changeDate(day.key)} disabled={busy}>
            <span>{day.key.slice(5)}</span>
            <strong>{day.progress.words.toLocaleString()} 字</strong>
            <small>{day.goal ? `目标 ${day.goal.toLocaleString()}` : "未设当日计划"}</small>
          </button>
        ))}
      </div>
    </div>
  );
};
