import { FormEvent, useEffect, useMemo, useState } from "react";
import { BookOpen, Link2, Plus, Save, Search, Trash2 } from "lucide-react";
import { findStoryReferences, type StoryReferenceHit, type TimelineEvent } from "@inkforge/schemas";
import { EntityDeleteDialog } from "@/features/library/EntityDeleteDialog";
import { useLibraryStore } from "@/stores/useLibraryStore";
import { useProjectStore } from "@/stores/useProjectStore";

const sourceKindLabels: Record<StoryReferenceHit["sourceKind"], string> = {
  character: "人物",
  world: "世界观",
  timeline: "事件",
  clue: "伏笔",
  conflict: "冲突",
  chapter: "章节"
};

const splitNames = (value: string): string[] =>
  value
    .split(/[,，]/u)
    .map((item) => item.trim())
    .filter(Boolean);

export const EventBoard = () => {
  const project = useProjectStore((state) => state.project);
  const timeline = useLibraryStore((state) => state.timeline);
  const characters = useLibraryStore((state) => state.characters);
  const worldEntries = useLibraryStore((state) => state.worldEntries);
  const clues = useLibraryStore((state) => state.clues);
  const terms = useLibraryStore((state) => state.terms);
  const conflicts = useLibraryStore((state) => state.conflicts);
  const saveTimelineEvent = useLibraryStore((state) => state.saveTimelineEvent);
  const [query, setQuery] = useState("");
  const [chapterFilter, setChapterFilter] = useState("all");
  const [draft, setDraft] = useState<TimelineEvent | undefined>();
  const [deleting, setDeleting] = useState<TimelineEvent | undefined>();

  const chapters = useMemo(
    () => project?.outline.volumes.flatMap((volume) => volume.chapters) ?? [],
    [project?.outline.volumes]
  );
  const locations = useMemo(() => worldEntries.filter((entry) => entry.type === "location"), [worldEntries]);
  const chapterTitle = (chapterId?: string) =>
    chapterId ? (chapters.find((chapter) => chapter.id === chapterId)?.title ?? chapterId) : "未关联章节";

  const filtered = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("zh-CN");
    return timeline.filter((event) => {
      if (chapterFilter === "none" && event.chapterId) return false;
      if (chapterFilter !== "all" && chapterFilter !== "none" && event.chapterId !== chapterFilter) return false;
      if (!keyword) return true;
      return [event.title, event.summary, event.location, ...event.participants]
        .join(" ")
        .toLocaleLowerCase("zh-CN")
        .includes(keyword);
    });
  }, [timeline, query, chapterFilter]);

  useEffect(() => {
    if (!draft && timeline.length) {
      setDraft(timeline[0]);
    }
    if (draft && !timeline.some((item) => item.id === draft.id) && !draft.id.startsWith("event_new")) {
      setDraft(timeline[0]);
    }
  }, [draft, timeline]);

  const references = useMemo(() => {
    if (!draft || !project) return [];
    return findStoryReferences(
      { characters, worldEntries, timeline, clues, terms, conflicts, chapters },
      { kind: "timeline", id: draft.id }
    );
  }, [draft?.id, characters, worldEntries, timeline, clues, terms, conflicts, chapters, project]);

  const create = () => {
    setDraft({
      id: `event_new_${Date.now()}`,
      order: timeline.length ? Math.max(...timeline.map((item) => item.order)) + 1 : 0,
      title: "新事件",
      location: "",
      participants: [],
      summary: ""
    });
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (draft) {
      void saveTimelineEvent(draft);
    }
  };

  return (
    <section className="library-screen event-board">
      <header className="library-header">
        <div>
          <div className="crumb">剧情</div>
          <h2>事件</h2>
          <p>事件与时间线共用同一数据源：这里提供完整编辑（章节关联、参与人物、发生地点与顺序）。</p>
        </div>
        <button className="primary-button" type="button" onClick={create}>
          <Plus size={17} />
          新事件
        </button>
      </header>

      <div className="draft-toolbar">
        <label>
          <Search size={15} />
          <input
            value={query}
            placeholder="搜索事件、参与者或地点"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <select value={chapterFilter} onChange={(event) => setChapterFilter(event.target.value)}>
          <option value="all">全部章节</option>
          <option value="none">未关联章节</option>
          {chapters.map((chapter) => (
            <option key={chapter.id} value={chapter.id}>
              {chapter.title}
            </option>
          ))}
        </select>
      </div>

      <div className="library-layout">
        <aside className="library-list">
          {filtered.map((event) => (
            <button
              className={draft?.id === event.id ? "selected" : ""}
              key={event.id}
              type="button"
              onClick={() => setDraft(event)}
            >
              <BookOpen size={17} />
              <span>
                <strong>{event.title}</strong>
                <small>
                  #{event.order} · {chapterTitle(event.chapterId)}
                  {event.location ? ` · ${event.location}` : ""}
                </small>
              </span>
            </button>
          ))}
          {!filtered.length ? <div className="empty-list-hint">没有匹配的事件。</div> : null}
        </aside>

        <form className="library-editor" onSubmit={submit}>
          {draft ? (
            <>
              <div className="field-grid">
                <label>
                  事件名称
                  <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
                </label>
                <label>
                  顺序
                  <input
                    type="number"
                    value={draft.order}
                    onChange={(event) => setDraft({ ...draft, order: Number(event.target.value) || 0 })}
                  />
                </label>
                <label>
                  关联章节
                  <select
                    value={draft.chapterId ?? ""}
                    onChange={(event) => setDraft({ ...draft, chapterId: event.target.value || undefined })}
                  >
                    <option value="">不关联章节</option>
                    {chapters.map((chapter) => (
                      <option key={chapter.id} value={chapter.id}>
                        {chapter.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  发生地点
                  <input
                    list="event-location-options"
                    value={draft.location}
                    onChange={(event) => setDraft({ ...draft, location: event.target.value })}
                  />
                  <datalist id="event-location-options">
                    {locations.map((location) => (
                      <option key={location.id} value={location.title} />
                    ))}
                  </datalist>
                </label>
              </div>
              <label>
                参与人物（逗号分隔）
                <input
                  list="event-character-options"
                  value={draft.participants.join(", ")}
                  onChange={(event) => setDraft({ ...draft, participants: splitNames(event.target.value) })}
                />
                <datalist id="event-character-options">
                  {characters.map((character) => (
                    <option key={character.id} value={character.name} />
                  ))}
                </datalist>
              </label>
              <label>
                概要
                <textarea
                  className="large-textarea"
                  value={draft.summary}
                  onChange={(event) => setDraft({ ...draft, summary: event.target.value })}
                />
              </label>

              <section className="entity-reference-panel">
                <header>
                  <Link2 size={14} />
                  <strong>被引用（{references.length}）</strong>
                </header>
                {references.length ? (
                  <ul>
                    {references.slice(0, 8).map((hit, index) => (
                      <li key={`${hit.sourceKind}-${hit.sourceId}-${index}`}>
                        <em>{sourceKindLabels[hit.sourceKind]}</em>
                        <strong>{hit.sourceTitle}</strong>
                        <span>{hit.field}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">还没有其他资料引用这个事件。</p>
                )}
              </section>

              <div className="library-editor-actions">
                <button className="primary-button" type="submit">
                  <Save size={17} />
                  保存事件
                </button>
                {timeline.some((item) => item.id === draft.id) ? (
                  <button className="secondary-button danger" type="button" onClick={() => setDeleting(draft)}>
                    <Trash2 size={15} />
                    删除
                  </button>
                ) : null}
              </div>
            </>
          ) : (
            <div className="library-empty">点击右上角"新事件"创建第一个事件。</div>
          )}
        </form>
      </div>

      {deleting ? (
        <EntityDeleteDialog
          target={{ kind: "timeline", id: deleting.id }}
          title={deleting.title}
          onClose={() => setDeleting(undefined)}
          onDeleted={() => setDraft(undefined)}
        />
      ) : null}
    </section>
  );
};
