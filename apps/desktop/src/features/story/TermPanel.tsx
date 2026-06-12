import { FormEvent, useMemo, useState } from "react";
import { Plus, Save, Tags } from "lucide-react";
import type { Term } from "@inkforge/schemas";
import { useLibraryStore } from "@/stores/useLibraryStore";

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
  const [draft, setDraft] = useState<Term | undefined>(selected);
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
    setSelectedId(term.id);
    setDraft(term);
  };

  const create = () => {
    const term = createTerm();
    setSelectedId(term.id);
    setDraft(term);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (draft) {
      void saveTerm(draft);
    }
  };

  return (
    <section className="library-screen">
      <header className="library-header">
        <div>
          <div className="crumb">一致性</div>
          <h2>术语表</h2>
        </div>
        <button className="primary-button" type="button" onClick={create}>
          <Plus size={17} />
          新术语
        </button>
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
        <form className="library-editor" onSubmit={submit}>
          {draft ? (
            <>
              <div className="field-grid">
                <label>
                  名称
                  <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
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
                <input
                  value={draft.aliases.join(",")}
                  onChange={(event) => setDraft({ ...draft, aliases: splitList(event.target.value) })}
                />
              </label>
              <label>
                定义
                <textarea
                  value={draft.definition}
                  onChange={(event) => setDraft({ ...draft, definition: event.target.value })}
                />
              </label>
              <button className="primary-button" type="submit">
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

const splitList = (value: string): string[] =>
  value
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
