import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link2, Plus, Save, Search, Swords, Trash2 } from "lucide-react";
import { findStoryReferences, type Conflict, type StoryReferenceHit } from "@inkforge/schemas";
import { EntityDeleteDialog } from "@/features/library/EntityDeleteDialog";
import { useLibraryStore } from "@/stores/useLibraryStore";
import { useProjectStore } from "@/stores/useProjectStore";

const kindLabels: Record<Conflict["kind"], string> = {
  main: "主线冲突",
  sub: "支线冲突",
  character: "人物冲突",
  faction: "势力冲突"
};

const statusLabels: Record<Conflict["status"], string> = {
  planned: "已规划",
  active: "进行中",
  escalating: "升级中",
  resolved: "已解决",
  abandoned: "已放弃"
};

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

export const ConflictBoard = () => {
  const project = useProjectStore((state) => state.project);
  const conflicts = useLibraryStore((state) => state.conflicts);
  const characters = useLibraryStore((state) => state.characters);
  const worldEntries = useLibraryStore((state) => state.worldEntries);
  const timeline = useLibraryStore((state) => state.timeline);
  const clues = useLibraryStore((state) => state.clues);
  const terms = useLibraryStore((state) => state.terms);
  const saveConflict = useLibraryStore((state) => state.saveConflict);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<Conflict["status"] | "all">("all");
  const [kindFilter, setKindFilter] = useState<Conflict["kind"] | "all">("all");
  const [draft, setDraft] = useState<Conflict | undefined>();
  const [deleting, setDeleting] = useState<Conflict | undefined>();

  const chapters = useMemo(
    () => project?.outline.volumes.flatMap((volume) => volume.chapters) ?? [],
    [project?.outline.volumes]
  );
  const chapterTitle = (chapterId: string) => chapters.find((chapter) => chapter.id === chapterId)?.title ?? chapterId;

  const filtered = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("zh-CN");
    return conflicts.filter((conflict) => {
      if (statusFilter !== "all" && conflict.status !== statusFilter) return false;
      if (kindFilter !== "all" && conflict.kind !== kindFilter) return false;
      if (!keyword) return true;
      return [conflict.title, conflict.summary, conflict.stakes, ...conflict.parties]
        .join(" ")
        .toLocaleLowerCase("zh-CN")
        .includes(keyword);
    });
  }, [conflicts, query, statusFilter, kindFilter]);

  useEffect(() => {
    if (!draft && conflicts.length) {
      setDraft(conflicts[0]);
    }
    if (draft && !conflicts.some((item) => item.id === draft.id) && !draft.id.startsWith("conflict_new")) {
      setDraft(conflicts[0]);
    }
  }, [draft, conflicts]);

  const references = useMemo(() => {
    if (!draft || !project) return [];
    return findStoryReferences(
      {
        characters,
        worldEntries,
        timeline,
        clues,
        terms,
        conflicts,
        chapters
      },
      { kind: "conflict", id: draft.id }
    );
  }, [draft?.id, characters, worldEntries, timeline, clues, terms, conflicts, chapters, project]);

  const create = () => {
    setDraft({
      id: `conflict_new_${Date.now()}`,
      title: "新冲突",
      kind: "sub",
      status: "planned",
      parties: [],
      stakes: "",
      relatedCharacters: [],
      relatedFactions: [],
      chapterIds: [],
      summary: "",
      notes: ""
    });
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (draft) {
      void saveConflict(draft);
    }
  };

  return (
    <section className="library-screen conflict-board">
      <header className="library-header">
        <div>
          <div className="crumb">剧情</div>
          <h2>冲突</h2>
          <p>集中管理主线、支线与人物冲突：各方、赌注、状态和关联章节，是推演与修订的事实来源。</p>
        </div>
        <button className="primary-button" type="button" onClick={create}>
          <Plus size={17} />
          新冲突
        </button>
      </header>

      <div className="draft-toolbar">
        <label>
          <Search size={15} />
          <input value={query} placeholder="搜索冲突、各方或赌注" onChange={(event) => setQuery(event.target.value)} />
        </label>
        <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value as typeof kindFilter)}>
          <option value="all">全部类型</option>
          {Object.entries(kindLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
          <option value="all">全部状态</option>
          {Object.entries(statusLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div className="library-layout">
        <aside className="library-list">
          {filtered.map((conflict) => (
            <button
              className={draft?.id === conflict.id ? "selected" : ""}
              key={conflict.id}
              type="button"
              onClick={() => setDraft(conflict)}
            >
              <Swords size={17} />
              <span>
                <strong>{conflict.title}</strong>
                <small>
                  {kindLabels[conflict.kind]} · {statusLabels[conflict.status]}
                  {conflict.parties.length ? ` · ${conflict.parties.slice(0, 3).join(" vs ")}` : ""}
                </small>
              </span>
            </button>
          ))}
          {!filtered.length ? <div className="empty-list-hint">没有匹配的冲突。</div> : null}
        </aside>

        <form className="library-editor" onSubmit={submit}>
          {draft ? (
            <>
              <div className="field-grid">
                <label>
                  冲突名称
                  <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
                </label>
                <label>
                  类型
                  <select
                    value={draft.kind}
                    onChange={(event) => setDraft({ ...draft, kind: event.target.value as Conflict["kind"] })}
                  >
                    {Object.entries(kindLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  状态
                  <select
                    value={draft.status}
                    onChange={(event) => setDraft({ ...draft, status: event.target.value as Conflict["status"] })}
                  >
                    {Object.entries(statusLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                冲突各方（逗号分隔）
                <input
                  value={draft.parties.join(", ")}
                  placeholder="例如：林烬, 缉私队"
                  onChange={(event) => setDraft({ ...draft, parties: splitNames(event.target.value) })}
                />
              </label>
              <div className="field-grid">
                <label>
                  涉及人物（逗号分隔）
                  <input
                    value={draft.relatedCharacters.join(", ")}
                    onChange={(event) => setDraft({ ...draft, relatedCharacters: splitNames(event.target.value) })}
                  />
                </label>
                <label>
                  涉及势力（逗号分隔）
                  <input
                    value={draft.relatedFactions.join(", ")}
                    onChange={(event) => setDraft({ ...draft, relatedFactions: splitNames(event.target.value) })}
                  />
                </label>
              </div>
              <label>
                赌注 / 输赢后果
                <textarea
                  value={draft.stakes}
                  onChange={(event) => setDraft({ ...draft, stakes: event.target.value })}
                />
              </label>
              <label>
                概要
                <textarea
                  value={draft.summary}
                  onChange={(event) => setDraft({ ...draft, summary: event.target.value })}
                />
              </label>
              <label>
                关联章节
                <div className="conflict-chapter-picker">
                  {chapters.map((chapter) => (
                    <label key={chapter.id} className="conflict-chapter-option">
                      <input
                        type="checkbox"
                        checked={draft.chapterIds.includes(chapter.id)}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            chapterIds: event.target.checked
                              ? [...draft.chapterIds, chapter.id]
                              : draft.chapterIds.filter((id) => id !== chapter.id)
                          })
                        }
                      />
                      <span>{chapter.title}</span>
                    </label>
                  ))}
                  {!chapters.length ? <span className="muted">还没有章节。</span> : null}
                </div>
              </label>
              {draft.chapterIds.length ? (
                <p className="muted">已关联：{draft.chapterIds.map(chapterTitle).join("、")}</p>
              ) : null}
              <label>
                备注
                <textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} />
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
                  <p className="muted">还没有其他资料引用这个冲突。</p>
                )}
              </section>

              <div className="library-editor-actions">
                <button className="primary-button" type="submit">
                  <Save size={17} />
                  保存冲突
                </button>
                {conflicts.some((item) => item.id === draft.id) ? (
                  <button className="secondary-button danger" type="button" onClick={() => setDeleting(draft)}>
                    <Trash2 size={15} />
                    删除
                  </button>
                ) : null}
              </div>
            </>
          ) : (
            <div className="library-empty">点击右上角"新冲突"，为主线或支线建立第一条冲突记录。</div>
          )}
        </form>
      </div>

      {deleting ? (
        <EntityDeleteDialog
          target={{ kind: "conflict", id: deleting.id }}
          title={deleting.title}
          onClose={() => setDeleting(undefined)}
          onDeleted={() => setDraft(undefined)}
        />
      ) : null}
    </section>
  );
};
