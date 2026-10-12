import { ReferencePicker } from "@/components/ReferencePicker";
import { NameReferencePicker } from "@/components/NameReferencePicker";
import { useReferenceOptions } from "@/lib/useReferenceOptions";
import { FormEvent, useMemo, useState } from "react";
import { Clock3, Plus, Save } from "lucide-react";
import type { TimelineEvent } from "@inkforge/schemas";
import { useLibraryStore } from "@/stores/useLibraryStore";
import { useEntityEditor } from "@/lib/useEntityEditor";
import { EditorFeedback } from "@/components/EditorFeedback";

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
  const options = useReferenceOptions();
  const timeline = useLibraryStore((state) => state.timeline);
  const saveTimelineEvent = useLibraryStore((state) => state.saveTimelineEvent);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(timeline[0]?.id ?? "");
  const selected = useMemo(
    () => timeline.find((item) => item.id === selectedId) ?? timeline[0],
    [selectedId, timeline]
  );
  const editor = useEntityEditor(selected, timeline, saveTimelineEvent, {
    module: "timeline",
    resetFilters: () => setQuery("")
  });
  const { draft, setDraft } = editor;
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
    if (event.id === draft?.id || !editor.canLeave()) return;
    setSelectedId(event.id);
    setDraft(event);
  };

  const create = () => {
    if (!editor.canLeave()) return;
    setQuery("");
    const event = createEvent((timeline.at(-1)?.order ?? 0) + 1);
    setSelectedId(event.id);
    setDraft(event);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (draft) {
      void editor.save();
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
                  {event.location || "地点未定"} /{" "}
                  {options.chapters.find((chapter) => chapter.value === event.chapterId)?.label ||
                    event.chapterId ||
                    "未关联章节"}
                </small>
              </span>
            </button>
          ))}
          {!filteredTimeline.length ? <div className="empty-list-hint">没有匹配的事件。</div> : null}
        </aside>
        <form className="library-editor" ref={editor.formRef} aria-busy={editor.busy} onSubmit={submit}>
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
                <ReferencePicker
                  key={`chapter-${draft.id}`}
                  label="关联章节"
                  options={options.chapters}
                  value={draft.chapterId ? [draft.chapterId] : []}
                  onChange={(value) => setDraft({ ...draft, chapterId: value[0] ?? "" })}
                />
              </div>
              <label>
                事件标题
                <input
                  required
                  value={draft.title}
                  onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                />
              </label>
              <NameReferencePicker
                key={`location-${draft.id}`}
                label="地点"
                options={options.locations}
                multiple={false}
                names={draft.location ? [draft.location] : []}
                ids={draft.locationId ? [draft.locationId] : []}
                onChange={(names, ids) => setDraft({ ...draft, location: names[0] ?? "", locationId: ids[0] ?? "" })}
              />
              <NameReferencePicker
                key={`participants-${draft.id}`}
                label="参与人物"
                options={options.characters}
                names={draft.participants}
                ids={draft.participantIds}
                onChange={(names, ids) => setDraft({ ...draft, participants: names, participantIds: ids })}
              />
              <label>
                摘要
                <textarea
                  value={draft.summary}
                  onChange={(event) => setDraft({ ...draft, summary: event.target.value })}
                />
              </label>
              <EditorFeedback {...editor} />
              <button className="primary-button" type="submit" disabled={editor.busy}>
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
