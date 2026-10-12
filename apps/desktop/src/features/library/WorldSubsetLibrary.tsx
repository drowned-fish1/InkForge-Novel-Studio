import { ListField } from "@/components/ListField";
import { NameReferencePicker } from "@/components/NameReferencePicker";
import { useReferenceOptions } from "@/lib/useReferenceOptions";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link2, Lock, MapPin, Plus, Save, Shield, Trash2, type LucideIcon } from "lucide-react";
import { findStoryReferences, type StoryReferenceHit, type WorldEntry } from "@inkforge/schemas";
import { EntityDeleteDialog } from "@/features/library/EntityDeleteDialog";
import { useLibraryStore } from "@/stores/useLibraryStore";
import { useProjectStore } from "@/stores/useProjectStore";
import { useEntityEditor } from "@/lib/useEntityEditor";
import { EditorFeedback } from "@/components/EditorFeedback";

const sourceKindLabels: Record<StoryReferenceHit["sourceKind"], string> = {
  character: "人物",
  world: "世界观",
  timeline: "事件",
  clue: "伏笔",
  conflict: "冲突",
  chapter: "章节"
};

interface WorldSubsetLibraryProps {
  crumb: string;
  title: string;
  description: string;
  icon: LucideIcon;
  entryTypes: Array<WorldEntry["type"]>;
  typeLabels: Partial<Record<WorldEntry["type"], string>>;
  defaultType: WorldEntry["type"];
  newLabel: string;
  idPrefix: string;
}

export const WorldSubsetLibrary = ({
  crumb,
  title,
  description,
  icon: Icon,
  entryTypes,
  typeLabels,
  defaultType,
  newLabel,
  idPrefix
}: WorldSubsetLibraryProps) => {
  const options = useReferenceOptions();
  const project = useProjectStore((state) => state.project);
  const worldEntries = useLibraryStore((state) => state.worldEntries);
  const characters = useLibraryStore((state) => state.characters);
  const timeline = useLibraryStore((state) => state.timeline);
  const clues = useLibraryStore((state) => state.clues);
  const terms = useLibraryStore((state) => state.terms);
  const conflicts = useLibraryStore((state) => state.conflicts);
  const saveWorldEntry = useLibraryStore((state) => state.saveWorldEntry);
  const entries = useMemo(
    () => worldEntries.filter((entry) => entryTypes.includes(entry.type)),
    [worldEntries, entryTypes]
  );
  const [query, setQuery] = useState("");
  const [, setSelectedId] = useState("");
  const editor = useEntityEditor<WorldEntry>(undefined, entries, saveWorldEntry, {
    module: defaultType === "location" ? "locations" : "factions",
    resetFilters: () => setQuery("")
  });
  const { draft, setDraft } = editor;
  const [deleting, setDeleting] = useState<WorldEntry | undefined>();

  const filtered = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("zh-CN");
    if (!keyword) return entries;
    return entries.filter((entry) =>
      [entry.title, entry.type, ...entry.tags, entry.summary, entry.content]
        .join(" ")
        .toLocaleLowerCase("zh-CN")
        .includes(keyword)
    );
  }, [entries, query]);

  useEffect(() => {
    if (!draft && entries.length) {
      setSelectedId(entries[0].id);
      setDraft(entries[0]);
    }
    if (draft && !entries.some((entry) => entry.id === draft.id) && !draft.id.startsWith(`${idPrefix}_new`)) {
      setDraft(entries[0]);
      setSelectedId(entries[0]?.id ?? "");
    }
  }, [draft, entries, idPrefix]);

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
        chapters: project.outline.volumes.flatMap((volume) => volume.chapters)
      },
      { kind: "world", id: draft.id }
    );
  }, [draft?.id, characters, worldEntries, timeline, clues, terms, conflicts, project]);

  const create = () => {
    if (!editor.canLeave()) return;
    setQuery("");
    const entry: WorldEntry = {
      id: `${idPrefix}_new_${Date.now()}`,
      title: newLabel,
      type: defaultType,
      locked: false,
      tags: [],
      summary: "",
      content: "",
      relatedCharacters: [],
      relatedClues: []
    };
    setSelectedId(entry.id);
    setDraft(entry);
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
          <div className="crumb">{crumb}</div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <button className="primary-button" type="button" onClick={create}>
          <Plus size={17} />
          {newLabel}
        </button>
      </header>

      <div className="library-layout">
        <aside className="library-list">
          <div className="library-filter-bar">
            <input
              aria-label={`搜索${title}`}
              placeholder="搜索名称 / 标签 / 摘要"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {filtered.map((entry) => (
            <button
              className={draft?.id === entry.id ? "selected" : ""}
              key={entry.id}
              type="button"
              onClick={() => {
                if (entry.id === draft?.id || !editor.canLeave()) return;
                setSelectedId(entry.id);
                setDraft(entry);
              }}
            >
              <Icon size={17} />
              <span>
                <strong>{entry.title}</strong>
                <small>
                  {typeLabels[entry.type] ?? entry.type}
                  {entry.locked ? " / 已锁定" : ""}
                </small>
              </span>
            </button>
          ))}
          {!filtered.length ? <div className="empty-list-hint">还没有{title}条目。</div> : null}
        </aside>

        <form className="library-editor" ref={editor.formRef} aria-busy={editor.busy} onSubmit={submit}>
          {draft ? (
            <>
              <div className="field-grid">
                <label>
                  名称
                  <input
                    required
                    value={draft.title}
                    onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                  />
                </label>
                <label>
                  类型
                  <select
                    value={draft.type}
                    onChange={(event) => setDraft({ ...draft, type: event.target.value as WorldEntry["type"] })}
                  >
                    {entryTypes.map((type) => (
                      <option key={type} value={type}>
                        {typeLabels[type] ?? type}
                      </option>
                    ))}
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
                <ListField
                  key={draft.id}
                  value={draft.tags}
                  onChange={(value) => setDraft({ ...draft, tags: value })}
                />
              </label>
              <NameReferencePicker
                key={`characters-${draft.id}`}
                label="关联人物"
                options={options.characters}
                names={draft.relatedCharacters}
                ids={draft.relatedCharacterIds}
                onChange={(names, ids) => setDraft({ ...draft, relatedCharacters: names, relatedCharacterIds: ids })}
              />
              <label>
                摘要
                <textarea
                  value={draft.summary}
                  onChange={(event) => setDraft({ ...draft, summary: event.target.value })}
                />
              </label>
              <label>
                设定正文
                <textarea
                  className="large-textarea"
                  value={draft.content}
                  onChange={(event) => setDraft({ ...draft, content: event.target.value })}
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
                    {references.length > 8 ? <li className="muted">…共 {references.length} 处引用</li> : null}
                  </ul>
                ) : (
                  <p className="muted">还没有其他资料引用这个条目。</p>
                )}
              </section>

              <EditorFeedback {...editor} />
              <div className="library-editor-actions">
                <button className="primary-button" type="submit" disabled={editor.busy}>
                  <Save size={17} />
                  保存
                </button>
                {entries.some((entry) => entry.id === draft.id) ? (
                  <button
                    className="secondary-button danger"
                    type="button"
                    disabled={editor.busy}
                    onClick={() => setDeleting(draft)}
                  >
                    <Trash2 size={15} />
                    删除
                  </button>
                ) : null}
              </div>
            </>
          ) : (
            <div className="library-empty">点击右上角"{newLabel}"创建第一条。</div>
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

export const LocationLibrary = () => (
  <WorldSubsetLibrary
    crumb="资料"
    title="地点"
    description="地点作为世界观条目（location 类型）保存，与世界观、时间线和章节引用共用同一数据源。"
    icon={MapPin}
    entryTypes={["location"]}
    typeLabels={{ location: "地点" }}
    defaultType="location"
    newLabel="新地点"
    idPrefix="location"
  />
);

export const FactionLibrary = () => (
  <WorldSubsetLibrary
    crumb="资料"
    title="势力"
    description="势力与组织作为世界观条目（faction / organization 类型）保存，可被人物关系、冲突和章节引用。"
    icon={Shield}
    entryTypes={["faction", "organization"]}
    typeLabels={{ faction: "势力", organization: "组织" }}
    defaultType="faction"
    newLabel="新势力"
    idPrefix="faction"
  />
);
