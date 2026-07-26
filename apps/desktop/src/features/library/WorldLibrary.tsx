import { FormEvent, useEffect, useMemo, useState } from "react";
import { BookMarked, Lock, Plus, Save, Trash2 } from "lucide-react";
import type { WorldEntry } from "@inkforge/schemas";
import { EntityDeleteDialog } from "@/features/library/EntityDeleteDialog";
import { useLibraryStore } from "@/stores/useLibraryStore";

const newEntry = (seed: number): WorldEntry => ({
  id: `world_${Date.now()}_${seed}`,
  title: "新设定",
  type: "note",
  locked: false,
  tags: ["待完善"],
  summary: "",
  content: "",
  relatedCharacters: [],
  relatedClues: []
});

export const WorldLibrary = () => {
  const entries = useLibraryStore((state) => state.worldEntries);
  const saveWorldEntry = useLibraryStore((state) => state.saveWorldEntry);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(entries[0]?.id ?? "");
  const selected = useMemo(() => entries.find((item) => item.id === selectedId) ?? entries[0], [entries, selectedId]);
  const [draft, setDraft] = useState<WorldEntry | undefined>(selected);
  const [deleting, setDeleting] = useState<WorldEntry | undefined>();
  const filteredEntries = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
      return entries;
    }
    return entries.filter((entry) =>
      [entry.title, entry.type, ...entry.tags, entry.summary, entry.content].join(" ").toLowerCase().includes(keyword)
    );
  }, [entries, query]);

  useEffect(() => {
    if (!draft && selected) {
      setSelectedId(selected.id);
      setDraft(selected);
    }
  }, [draft, selected]);

  const choose = (entry: WorldEntry) => {
    setSelectedId(entry.id);
    setDraft(entry);
  };

  const create = () => {
    const entry = newEntry(entries.length + 1);
    setSelectedId(entry.id);
    setDraft(entry);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (draft) {
      void saveWorldEntry(draft);
    }
  };

  return (
    <section className="library-screen">
      <header className="library-header">
        <div>
          <div className="crumb">资料库</div>
          <h2>世界观设定</h2>
        </div>
        <button className="primary-button" type="button" onClick={create}>
          <Plus size={17} />
          新设定
        </button>
      </header>

      <div className="library-layout">
        <aside className="library-list">
          <div className="library-filter-bar">
            <input
              aria-label="搜索设定"
              placeholder="搜索标题 / 标签 / 摘要"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {filteredEntries.map((entry) => (
            <button
              className={draft?.id === entry.id ? "selected" : ""}
              key={entry.id}
              type="button"
              onClick={() => choose(entry)}
            >
              <BookMarked size={17} />
              <span>
                <strong>{entry.title}</strong>
                <small>
                  {entry.type}
                  {entry.locked ? " / 已锁定" : ""}
                </small>
              </span>
            </button>
          ))}
          {!filteredEntries.length ? <div className="empty-list-hint">没有匹配的设定。</div> : null}
        </aside>

        <form className="library-editor" onSubmit={submit}>
          {draft ? (
            <>
              <div className="field-grid">
                <label>
                  标题
                  <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
                </label>
                <label>
                  类型
                  <select
                    value={draft.type}
                    onChange={(event) => setDraft({ ...draft, type: event.target.value as WorldEntry["type"] })}
                  >
                    <option value="note">普通设定</option>
                    <option value="location">地点</option>
                    <option value="faction">势力</option>
                    <option value="organization">组织</option>
                    <option value="power-system">修炼体系</option>
                    <option value="item">物品</option>
                    <option value="skill">技能</option>
                    <option value="race">种族</option>
                    <option value="rule">规则</option>
                    <option value="history">历史事件</option>
                  </select>
                </label>
              </div>
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={draft.locked}
                  onChange={(event) => setDraft({ ...draft, locked: event.target.checked })}
                />
                <Lock size={15} />
                锁定设定，AI 续写不得随意改写
              </label>
              <label>
                标签
                <input
                  value={draft.tags.join(",")}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      tags: event.target.value
                        .split(",")
                        .map((item) => item.trim())
                        .filter(Boolean)
                    })
                  }
                />
              </label>
              <label>
                摘要
                <textarea
                  value={draft.summary}
                  onChange={(event) => setDraft({ ...draft, summary: event.target.value })}
                />
              </label>
              <label>
                正文
                <textarea
                  className="large-textarea"
                  value={draft.content}
                  onChange={(event) => setDraft({ ...draft, content: event.target.value })}
                />
              </label>
              <div className="library-editor-actions">
                <button className="primary-button" type="submit">
                  <Save size={17} />
                  保存设定
                </button>
                {entries.some((item) => item.id === draft.id) ? (
                  <button className="secondary-button danger" type="button" onClick={() => setDeleting(draft)}>
                    <Trash2 size={15} />
                    删除
                  </button>
                ) : null}
              </div>
            </>
          ) : (
            <div className="library-empty">还没有世界观设定。</div>
          )}
        </form>
      </div>

      {deleting ? (
        <EntityDeleteDialog
          target={{ kind: "world", id: deleting.id }}
          title={deleting.title}
          onClose={() => setDeleting(undefined)}
          onDeleted={() => {
            setDraft(undefined);
            setSelectedId("");
          }}
        />
      ) : null}
    </section>
  );
};
