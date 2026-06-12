import { FormEvent, useMemo, useState } from "react";
import { Clock3, Plus, Save } from "lucide-react";
import type { TimelineEvent } from "@inkforge/schemas";
import { useLibraryStore } from "@/stores/useLibraryStore";

const createEvent = (order: number): TimelineEvent => ({
  id: `event_${Date.now()}`,
  order,
  title: "新事件",
  chapterId: "",
  location: "",
  participants: [],
  summary: ""
});

export const TimelinePanel = () => {
  const timeline = useLibraryStore((state) => state.timeline);
  const saveTimelineEvent = useLibraryStore((state) => state.saveTimelineEvent);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(timeline[0]?.id ?? "");
  const selected = useMemo(
    () => timeline.find((item) => item.id === selectedId) ?? timeline[0],
    [selectedId, timeline]
  );
  const [draft, setDraft] = useState<TimelineEvent | undefined>(selected);
  const filteredTimeline = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
      return timeline;
    }
    return timeline.filter((event) =>
      [event.title, event.location, event.chapterId ?? "", ...event.participants, event.summary]
        .join(" ")
        .toLowerCase()
        .includes(keyword)
    );
  }, [query, timeline]);

  const choose = (event: TimelineEvent) => {
    setSelectedId(event.id);
    setDraft(event);
  };

  const create = () => {
    const event = createEvent((timeline.at(-1)?.order ?? 0) + 1);
    setSelectedId(event.id);
    setDraft(event);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (draft) {
      void saveTimelineEvent(draft);
    }
  };

  return (
    <section className="library-screen">
      <header className="library-header">
        <div>
          <div className="crumb">长篇管理</div>
          <h2>时间线</h2>
        </div>
        <button className="primary-button" type="button" onClick={create}>
          <Plus size={17} />
          新事件
        </button>
      </header>
      <div className="library-layout">
        <aside className="library-list">
          <div className="library-filter-bar">
            <input
              aria-label="搜索时间线"
              placeholder="搜索标题 / 标签 / 摘要"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {filteredTimeline.map((event) => (
            <button
              className={draft?.id === event.id ? "selected" : ""}
              key={event.id}
              type="button"
              onClick={() => choose(event)}
            >
              <Clock3 size={17} />
              <span>
                <strong>
                  {event.order}. {event.title}
                </strong>
                <small>
                  {event.location || "地点未定"} / {event.chapterId || "未关联章节"}
                </small>
              </span>
            </button>
          ))}
          {!filteredTimeline.length ? <div className="empty-list-hint">没有匹配的事件。</div> : null}
        </aside>
        <form className="library-editor" onSubmit={submit}>
          {draft ? (
            <>
              <div className="field-grid">
                <label>
                  顺序
                  <input
                    type="number"
                    value={draft.order}
                    onChange={(event) => setDraft({ ...draft, order: Number(event.target.value) })}
                  />
                </label>
                <label>
                  章节 ID
                  <input
                    value={draft.chapterId ?? ""}
                    onChange={(event) => setDraft({ ...draft, chapterId: event.target.value })}
                  />
                </label>
              </div>
              <label>
                事件标题
                <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
              </label>
              <label>
                地点
                <input
                  value={draft.location}
                  onChange={(event) => setDraft({ ...draft, location: event.target.value })}
                />
              </label>
              <label>
                参与人物
                <input
                  value={draft.participants.join(",")}
                  onChange={(event) => setDraft({ ...draft, participants: splitList(event.target.value) })}
                />
              </label>
              <label>
                摘要
                <textarea
                  value={draft.summary}
                  onChange={(event) => setDraft({ ...draft, summary: event.target.value })}
                />
              </label>
              <button className="primary-button" type="submit">
                <Save size={17} />
                保存事件
              </button>
            </>
          ) : (
            <div className="library-empty">还没有时间线事件。</div>
          )}
        </form>
      </div>
    </section>
  );
};

const splitList = (value: string): string[] =>
  value
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
