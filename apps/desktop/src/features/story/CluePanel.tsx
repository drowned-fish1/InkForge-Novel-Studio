import { ReferencePicker } from "@/components/ReferencePicker";
import { NameReferencePicker } from "@/components/NameReferencePicker";
import { useReferenceOptions } from "@/lib/useReferenceOptions";
import { FormEvent, useMemo, useState } from "react";
import { Milestone, Plus, Save } from "lucide-react";
import type { Clue } from "@inkforge/schemas";
import { useLibraryStore } from "@/stores/useLibraryStore";
import { useEntityEditor } from "@/lib/useEntityEditor";
import { EditorFeedback } from "@/components/EditorFeedback";

type ClueStatusFilter = "all" | Clue["status"];

const clueStatusLabels: Record<Clue["status"], string> = {
  planned: "已规划",
  planted: "已埋设",
  developed: "已展开",
  resolved: "已回收",
  abandoned: "已放弃"
};

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
  const options = useReferenceOptions();
  const clues = useLibraryStore((state) => state.clues);
  const saveClue = useLibraryStore((state) => state.saveClue);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ClueStatusFilter>("all");
  const [selectedId, setSelectedId] = useState(clues[0]?.id ?? "");
  const selected = useMemo(() => clues.find((item) => item.id === selectedId) ?? clues[0], [clues, selectedId]);
  const editor = useEntityEditor(selected, clues, saveClue, {
    module: "clues",
    resetFilters: () => {
      setQuery("");
      setStatusFilter("all");
    }
  });
  const { draft, setDraft } = editor;
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
    if (clue.id === draft?.id || !editor.canLeave()) return;
    setSelectedId(clue.id);
    setDraft(clue);
  };

  const create = () => {
    if (!editor.canLeave()) return;
    setQuery("");
    setStatusFilter("all");
    const clue = createClue();
    setSelectedId(clue.id);
    setDraft(clue);
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
            <select
              aria-label="按伏笔状态筛选"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as ClueStatusFilter)}
            >
              <option value="all">全部状态</option>
              <option value="planned">已规划</option>
              <option value="planted">已埋设</option>
              <option value="developed">已展开</option>
              <option value="resolved">已回收</option>
              <option value="abandoned">已放弃</option>
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
                  {clueStatusLabels[clue.status]} /{" "}
                  {options.chapters.find((chapter) => chapter.value === clue.plantedChapterId)?.label ||
                    clue.plantedChapterId ||
                    "未埋设"}
                </small>
              </span>
            </button>
          ))}
          {!filteredClues.length ? <div className="empty-list-hint">没有匹配的伏笔。</div> : null}
        </aside>
        <form className="library-editor" ref={editor.formRef} aria-busy={editor.busy} onSubmit={submit}>
          {draft ? (
            <>
              <label>
                标题
                <input
                  required
                  value={draft.title}
                  onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                />
              </label>
              <div className="field-grid">
                <ReferencePicker
                  key={`chapter-${draft.id}`}
                  label="埋设章节"
                  options={options.chapters}
                  value={draft.plantedChapterId ? [draft.plantedChapterId] : []}
                  onChange={(value) => setDraft({ ...draft, plantedChapterId: value[0] ?? "" })}
                />
                <label>
                  状态
                  <select
                    value={draft.status}
                    onChange={(event) => setDraft({ ...draft, status: event.target.value as Clue["status"] })}
                  >
                    <option value="planned">已规划</option>
                    <option value="planted">已埋设</option>
                    <option value="developed">已展开</option>
                    <option value="resolved">已回收</option>
                    <option value="abandoned">已放弃</option>
                  </select>
                </label>
              </div>
              <NameReferencePicker
                key={`characters-${draft.id}`}
                label="相关人物"
                options={options.characters}
                names={draft.relatedCharacters}
                ids={draft.relatedCharacterIds}
                onChange={(names, ids) => setDraft({ ...draft, relatedCharacters: names, relatedCharacterIds: ids })}
              />
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
              <EditorFeedback {...editor} />
              <button className="primary-button" type="submit" disabled={editor.busy}>
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
