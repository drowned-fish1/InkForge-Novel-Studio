import { ListField } from "@/components/ListField";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Plus, Save, Sparkles, Trash2, UserRound } from "lucide-react";
import type { Character } from "@inkforge/schemas";
import { EntityDeleteDialog } from "@/features/library/EntityDeleteDialog";
import { useLibraryStore } from "@/stores/useLibraryStore";
import { useEntityEditor } from "@/lib/useEntityEditor";
import { EditorFeedback } from "@/components/EditorFeedback";
import { PinWritingReferenceButton } from "@/components/PinWritingReferenceButton";
import { CharacterAiGenerator } from "./CharacterAiGenerator";
import { useProjectStore } from "@/stores/useProjectStore";
import "../project/writingManagement.css";

type CharacterTier = "primary" | "secondary" | "minor";
type RoleFilter = "all" | CharacterTier;

const tierOrder: CharacterTier[] = ["primary", "secondary", "minor"];
const tierLabels: Record<CharacterTier, string> = {
  primary: "主要人物",
  secondary: "次要人物",
  minor: "临时人物"
};
const roleOptions = [
  { value: "protagonist", label: "主角（主要人物）" },
  { value: "antagonist", label: "重要反派（主要人物）" },
  { value: "supporting", label: "配角（次要人物）" },
  { value: "minor", label: "临时 / 龙套人物" }
] as const;

const newCharacter = (seed: number): Character => ({
  id: `char_${Date.now()}_${seed}`,
  name: "新角色",
  aliases: [],
  role: "supporting",
  tags: ["待完善"],
  profile: {
    age: "",
    identity: "",
    motivation: "",
    personality: ""
  },
  currentState: {
    arc: "",
    powerLevel: "",
    location: "",
    relationships: [],
    secrets: []
  },
  voiceNotes: ""
});

export const CharacterLibrary = () => {
  const characters = useLibraryStore((state) => state.characters);
  const saveCharacter = useLibraryStore((state) => state.saveCharacter);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [selectedId, setSelectedId] = useState(characters[0]?.id ?? "");
  const selected = useMemo(
    () => characters.find((item) => item.id === selectedId) ?? characters[0],
    [characters, selectedId]
  );
  const editor = useEntityEditor(selected, characters, saveCharacter, {
    module: "characters",
    resetFilters: () => {
      setQuery("");
      setRoleFilter("all");
    }
  });
  const { draft, setDraft } = editor;
  const projectPath = useProjectStore((state) => state.project?.projectPath);
  const [aiOpen, setAiOpen] = useState(false);
  const [deleting, setDeleting] = useState<Character | undefined>();
  const filteredCharacters = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return characters.filter((character) => {
      const matchesRole = roleFilter === "all" || characterTier(character.role) === roleFilter;
      const searchable = [
        character.name,
        character.role,
        ...character.aliases,
        ...character.tags,
        character.profile.identity,
        character.profile.motivation,
        character.profile.personality,
        character.currentState.arc,
        character.currentState.location,
        character.voiceNotes
      ]
        .join(" ")
        .toLowerCase();
      return matchesRole && (!keyword || searchable.includes(keyword));
    });
  }, [characters, query, roleFilter]);
  const groupedCharacters = useMemo(
    () =>
      tierOrder.map((tier) => ({
        tier,
        characters: filteredCharacters.filter((character) => characterTier(character.role) === tier)
      })),
    [filteredCharacters]
  );

  useEffect(() => {
    if (!draft && selected) {
      setSelectedId(selected.id);
      setDraft(selected);
    }
  }, [draft, selected]);

  const choose = (character: Character) => {
    if (character.id === draft?.id || !editor.canLeave()) return;
    setSelectedId(character.id);
    setDraft(character);
  };

  const create = () => {
    if (!editor.canLeave()) return;
    setQuery("");
    setRoleFilter("all");
    const character = newCharacter(characters.length + 1);
    setSelectedId(character.id);
    setDraft(character);
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
          <div className="crumb">资料库</div>
          <h2>人物卡</h2>
        </div>
        <div className="character-ai-actions">
          <PinWritingReferenceButton
            disabled={editor.busy}
            target={
              draft && characters.some((item) => item.id === draft.id) ? { kind: "character", id: draft.id } : undefined
            }
          />
          <button
            className="secondary-button"
            type="button"
            disabled={editor.busy}
            onClick={() => {
              if (!draft) create();
              setAiOpen(true);
            }}
          >
            <Sparkles size={16} />
            AI 人物卡／起名
          </button>
          <button className="primary-button" type="button" onClick={create} disabled={editor.busy}>
            <Plus size={17} />
            新角色
          </button>
        </div>
      </header>

      <div className="library-layout">
        <aside className="library-list">
          <div className="library-filter-bar two-column">
            <input
              aria-label="搜索人物"
              placeholder="搜索姓名 / 标签 / 摘要"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <select
              aria-label="按人物角色筛选"
              value={roleFilter}
              onChange={(event) => setRoleFilter(event.target.value as RoleFilter)}
            >
              <option value="all">全部人物</option>
              <option value="primary">主要人物</option>
              <option value="secondary">次要人物</option>
              <option value="minor">临时人物</option>
            </select>
          </div>
          {groupedCharacters.map((group) =>
            group.characters.length ? (
              <section className="character-list-group" key={group.tier}>
                <div className="character-list-group-title">
                  <span>{tierLabels[group.tier]}</span>
                  <b>{group.characters.length}</b>
                </div>
                {group.characters.map((character) => (
                  <button
                    className={draft?.id === character.id ? "selected" : ""}
                    key={character.id}
                    type="button"
                    onClick={() => choose(character)}
                  >
                    <UserRound size={17} />
                    <span>
                      <strong>{character.name}</strong>
                      <small>
                        {roleLabel(character.role)} / {character.currentState.location || "位置未定"}
                      </small>
                    </span>
                  </button>
                ))}
              </section>
            ) : null
          )}
          {!filteredCharacters.length ? <div className="empty-list-hint">没有匹配的人物。</div> : null}
        </aside>

        <form className="library-editor" ref={editor.formRef} aria-busy={editor.busy} onSubmit={submit}>
          {draft ? (
            <>
              {aiOpen ? (
                <CharacterAiGenerator
                  key={`${projectPath}:${draft.id}`}
                  draft={draft}
                  setDraft={setDraft}
                  disabled={editor.busy}
                  onClose={() => setAiOpen(false)}
                />
              ) : null}
              <label>
                姓名
                <input
                  required
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </label>
              <label>
                人物层级
                <select value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value })}>
                  {!roleOptions.some((option) => option.value === draft.role) ? (
                    <option value={draft.role}>{draft.role || "未分类"}</option>
                  ) : null}
                  {roleOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                标签
                <ListField
                  key={draft.id}
                  value={draft.tags}
                  onChange={(value) => setDraft({ ...draft, tags: value })}
                />
              </label>
              <div className="field-grid">
                <label>
                  年龄
                  <input
                    value={draft.profile.age}
                    onChange={(event) => setDraft({ ...draft, profile: { ...draft.profile, age: event.target.value } })}
                  />
                </label>
                <label>
                  当前境界
                  <input
                    value={draft.currentState.powerLevel}
                    onChange={(event) =>
                      setDraft({ ...draft, currentState: { ...draft.currentState, powerLevel: event.target.value } })
                    }
                  />
                </label>
              </div>
              <label>
                身份
                <input
                  value={draft.profile.identity}
                  onChange={(event) =>
                    setDraft({ ...draft, profile: { ...draft.profile, identity: event.target.value } })
                  }
                />
              </label>
              <label>
                动机
                <textarea
                  value={draft.profile.motivation}
                  onChange={(event) =>
                    setDraft({ ...draft, profile: { ...draft.profile, motivation: event.target.value } })
                  }
                />
              </label>
              <label>
                别名
                <ListField
                  key={draft.id}
                  value={draft.aliases}
                  onChange={(aliases) => setDraft({ ...draft, aliases })}
                />
              </label>
              <label>
                性格
                <textarea
                  value={draft.profile.personality}
                  onChange={(event) =>
                    setDraft({ ...draft, profile: { ...draft.profile, personality: event.target.value } })
                  }
                />
              </label>
              <label>
                人物关系
                <ListField
                  key={draft.id}
                  multiline
                  value={draft.currentState.relationships}
                  onChange={(value) =>
                    setDraft({
                      ...draft,
                      currentState: {
                        ...draft.currentState,
                        relationships: value,
                        relationshipCharacterIds: undefined
                      }
                    })
                  }
                />
              </label>
              <label>
                成长线
                <textarea
                  value={draft.currentState.arc}
                  onChange={(event) =>
                    setDraft({ ...draft, currentState: { ...draft.currentState, arc: event.target.value } })
                  }
                />
              </label>
              <label>
                当前位置
                <input
                  value={draft.currentState.location}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      currentState: { ...draft.currentState, location: event.target.value, locationId: undefined }
                    })
                  }
                />
              </label>
              <label>
                秘密
                <ListField
                  key={draft.id}
                  multiline
                  value={draft.currentState.secrets}
                  onChange={(secrets) => setDraft({ ...draft, currentState: { ...draft.currentState, secrets } })}
                />
              </label>
              <label>
                口吻备注
                <textarea
                  value={draft.voiceNotes}
                  onChange={(event) => setDraft({ ...draft, voiceNotes: event.target.value })}
                />
              </label>
              <EditorFeedback {...editor} />
              <div className="library-editor-actions">
                <button className="primary-button" type="submit" disabled={editor.busy}>
                  <Save size={17} />
                  保存人物卡
                </button>
                {characters.some((item) => item.id === draft.id) ? (
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
            <div className="library-empty">还没有人物卡。</div>
          )}
        </form>
      </div>

      {deleting ? (
        <EntityDeleteDialog
          target={{ kind: "character", id: deleting.id }}
          title={deleting.name}
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

const characterTier = (role: string): CharacterTier => {
  const normalized = role.toLowerCase();
  if (
    ["protagonist", "main", "lead", "antagonist", "villain", "主角", "主要", "反派"].some((alias) =>
      normalized.includes(alias)
    )
  ) {
    return "primary";
  }
  if (
    ["minor", "cameo", "background", "temporary", "龙套", "临时", "路人"].some((alias) => normalized.includes(alias))
  ) {
    return "minor";
  }
  return "secondary";
};

const roleLabel = (role: string): string =>
  roleOptions.find((option) => option.value === role)?.label.split("（")[0] ?? role;
