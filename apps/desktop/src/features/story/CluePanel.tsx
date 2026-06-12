import { FormEvent, useMemo, useState } from "react";
import { Milestone, Plus, Save } from "lucide-react";
import type { Clue } from "@inkforge/schemas";
import { useLibraryStore } from "@/stores/useLibraryStore";

type ClueStatusFilter = "all" | Clue["status"];

const createClue = (): Clue => ({
  id: `clue_${Date.now()}`,
  title: "新伏笔",
  plantedChapterId: "",
  relatedCharacters: [],
  expectedPayoff: "",
  status: "planned",
  notes: ""
});

export const CluePanel = () => {
  const clues = useLibraryStore((state) => state.clues);
  const saveClue = useLibraryStore((state) => state.saveClue);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ClueStatusFilter>("all");
  const [selectedId, setSelectedId] = useState(clues[0]?.id ?? "");
  const selected = useMemo(() => clues.find((item) => item.id === selectedId) ?? clues[0], [clues, selectedId]);
  const [draft, setDraft] = useState<Clue | undefined>(selected);
  const filteredClues = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return clues.filter((clue) => {
      const matchesStatus = statusFilter === "all" || clue.status === statusFilter;
      const searchable = [
        clue.title,
        clue.status,
        clue.plantedChapterId ?? "",
        ...clue.relatedCharacters,
        clue.expectedPayoff,
        clue.notes
      ]
        .join(" ")
        .toLowerCase();
      return matchesStatus && (!keyword || searchable.includes(keyword));
    });
  }, [clues, query, statusFilter]);

  const choose = (clue: Clue) => {
    setSelectedId(clue.id);
    setDraft(clue);
  };

  const create = () => {
    const clue = createClue();
    setSelectedId(clue.id);
    setDraft(clue);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (draft) {
      void saveClue(draft);
    }
  };

  return (
    <section className="library-screen">
      <header className="library-header">
        <div>
          <div className="crumb">长篇管理</div>
          <h2>伏笔</h2>
        </div>
        <button className="primary-button" type="button" onClick={create}>
          <Plus size={17} />
          新伏笔
        </button>
      </header>
      <div className="library-layout">
        <aside className="library-list">
          <div className="library-filter-bar two-column">
            <input
              aria-label="搜索伏笔"
              placeholder="搜索标题 / 标签 / 摘要"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as ClueStatusFilter)}>
              <option value="all">全部状态</option>
              <option value="planned">planned</option>
              <option value="planted">planted</option>
              <option value="developed">developed</option>
              <option value="resolved">resolved</option>
              <option value="abandoned">abandoned</option>
            </select>
          </div>
          {filteredClues.map((clue) => (
            <button
              className={draft?.id === clue.id ? "selected" : ""}
              key={clue.id}
              type="button"
              onClick={() => choose(clue)}
            >
              <Milestone size={17} />
              <span>
                <strong>{clue.title}</strong>
                <small>
                  {clue.status} / {clue.plantedChapterId || "未埋设"}
                </small>
              </span>
            </button>
          ))}
          {!filteredClues.length ? <div className="empty-list-hint">没有匹配的伏笔。</div> : null}
        </aside>
        <form className="library-editor" onSubmit={submit}>
          {draft ? (
            <>
              <label>
                标题
                <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
              </label>
              <div className="field-grid">
                <label>
                  埋设章节 ID
                  <input
                    value={draft.plantedChapterId ?? ""}
                    onChange={(event) => setDraft({ ...draft, plantedChapterId: event.target.value })}
                  />
                </label>
                <label>
                  状态
                  <select
                    value={draft.status}
                    onChange={(event) => setDraft({ ...draft, status: event.target.value as Clue["status"] })}
                  >
                    <option value="planned">planned</option>
                    <option value="planted">planted</option>
                    <option value="developed">developed</option>
                    <option value="resolved">resolved</option>
                    <option value="abandoned">abandoned</option>
                  </select>
                </label>
              </div>
              <label>
                相关人物
                <input
                  value={draft.relatedCharacters.join(",")}
                  onChange={(event) => setDraft({ ...draft, relatedCharacters: splitList(event.target.value) })}
                />
              </label>
              <label>
                预期回收
                <textarea
                  value={draft.expectedPayoff}
                  onChange={(event) => setDraft({ ...draft, expectedPayoff: event.target.value })}
                />
              </label>
              <label>
                备注
                <textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} />
              </label>
              <button className="primary-button" type="submit">
                <Save size={17} />
                保存伏笔
              </button>
            </>
          ) : (
            <div className="library-empty">还没有伏笔。</div>
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
