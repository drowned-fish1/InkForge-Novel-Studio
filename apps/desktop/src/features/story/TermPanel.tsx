import { ListField } from "@/components/ListField";
import { FormEvent, useMemo, useState } from "react";
import { Plus, Save, Tags } from "lucide-react";
import type { Term } from "@inkforge/schemas";
import { useLibraryStore } from "@/stores/useLibraryStore";
import { useEntityEditor } from "@/lib/useEntityEditor";
import { EditorFeedback } from "@/components/EditorFeedback";
import { PinWritingReferenceButton } from "@/components/PinWritingReferenceButton";

const createTerm = (): Term => ({
  id: `term_${Date.now()}`,
  name: "新术语",
  category: "term",
  aliases: [],
  definition: "",
  locked: false
});

export const TermPanel = () => {
  const terms = useLibraryStore((state) => state.terms);
  const saveTerm = useLibraryStore((state) => state.saveTerm);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(terms[0]?.id ?? "");
  const selected = useMemo(() => terms.find((item) => item.id === selectedId) ?? terms[0], [selectedId, terms]);
  const editor = useEntityEditor(selected, terms, saveTerm, { module: "terms", resetFilters: () => setQuery("") });
  const { draft, setDraft } = editor;
  const filteredTerms = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
      return terms;
    }
    return terms.filter((term) =>
      [term.name, term.category, ...term.aliases, term.definition].join(" ").toLowerCase().includes(keyword)
    );
  }, [query, terms]);

  const choose = (term: Term) => {
    if (term.id === draft?.id || !editor.canLeave()) return;
    setSelectedId(term.id);
    setDraft(term);
  };

  const create = () => {
    if (!editor.canLeave()) return;
    setQuery("");
    const term = createTerm();
    setSelectedId(term.id);
    setDraft(term);
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
          <div className="crumb">一致性</div>
          <h2>术语表</h2>
        </div>
        <div className="library-pin-actions">
          <PinWritingReferenceButton
            disabled={editor.busy}
            target={draft && terms.some((item) => item.id === draft.id) ? { kind: "term", id: draft.id } : undefined}
          />
          <button className="primary-button" type="button" onClick={create}>
            <Plus size={17} />
            新术语
          </button>
        </div>
      </header>
      <div className="library-layout">
        <aside className="library-list">
          <div className="library-filter-bar">
            <input
              aria-label="搜索术语"
              placeholder="搜索名称 / 标签 / 摘要"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {filteredTerms.map((term) => (
            <button
              className={draft?.id === term.id ? "selected" : ""}
              key={term.id}
              type="button"
              onClick={() => choose(term)}
            >
              <Tags size={17} />
              <span>
                <strong>{term.name}</strong>
                <small>
                  {term.category}
                  {term.locked ? " / locked" : ""}
                </small>
              </span>
            </button>
          ))}
          {!filteredTerms.length ? <div className="empty-list-hint">没有匹配的术语。</div> : null}
        </aside>
        <form className="library-editor" ref={editor.formRef} aria-busy={editor.busy} onSubmit={submit}>
          {draft ? (
            <>
              <div className="field-grid">
                <label>
                  名称
                  <input
                    required
                    value={draft.name}
                    onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  />
                </label>
                <label>
                  类别
                  <input
                    value={draft.category}
                    onChange={(event) => setDraft({ ...draft, category: event.target.value })}
                  />
                </label>
              </div>
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={draft.locked}
                  onChange={(event) => setDraft({ ...draft, locked: event.target.checked })}
                />
                锁定术语写法
              </label>
              <label>
                别名
                <ListField
                  key={draft.id}
                  value={draft.aliases}
                  onChange={(value) => setDraft({ ...draft, aliases: value })}
                />
              </label>
              <label>
                定义
                <textarea
                  value={draft.definition}
                  onChange={(event) => setDraft({ ...draft, definition: event.target.value })}
                />
              </label>
              <EditorFeedback {...editor} />
              <button className="primary-button" type="submit" disabled={editor.busy}>
                <Save size={17} />
                保存术语
              </button>
            </>
          ) : (
            <div className="library-empty">还没有术语。</div>
          )}
        </form>
      </div>
    </section>
  );
};
