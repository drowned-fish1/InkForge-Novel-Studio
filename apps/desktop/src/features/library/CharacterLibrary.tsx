import { FormEvent, useEffect, useMemo, useState } from "react";
import { Plus, Save, UserRound } from "lucide-react";
import type { Character } from "@inkforge/schemas";
import { useLibraryStore } from "@/stores/useLibraryStore";

type RoleFilter = "all" | "protagonist" | "supporting" | "antagonist";

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
  const [draft, setDraft] = useState<Character | undefined>(selected);
  const filteredCharacters = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return characters.filter((character) => {
      const matchesRole = characterMatchesRole(character.role, roleFilter);
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

  useEffect(() => {
    if (!draft && selected) {
      setSelectedId(selected.id);
      setDraft(selected);
    }
  }, [draft, selected]);

  const choose = (character: Character) => {
    setSelectedId(character.id);
    setDraft(character);
  };

  const create = () => {
    const character = newCharacter(characters.length + 1);
    setSelectedId(character.id);
    setDraft(character);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (draft) {
      void saveCharacter(draft);
    }
  };

  return (
    <section className="library-screen">
      <header className="library-header">
        <div>
          <div className="crumb">资料库</div>
          <h2>人物卡</h2>
        </div>
        <button className="primary-button" type="button" onClick={create}>
          <Plus size={17} />
          新角色
        </button>
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
            <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as RoleFilter)}>
              <option value="all">全部角色</option>
              <option value="protagonist">主角</option>
              <option value="supporting">配角</option>
              <option value="antagonist">反派</option>
            </select>
          </div>
          {filteredCharacters.map((character) => (
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
                  {character.role} / {character.currentState.location || "位置未定"}
                </small>
              </span>
            </button>
          ))}
          {!filteredCharacters.length ? <div className="empty-list-hint">没有匹配的人物。</div> : null}
        </aside>

        <form className="library-editor" onSubmit={submit}>
          {draft ? (
            <>
              <label>
                姓名
                <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
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
                当前状态
                <textarea
                  value={draft.currentState.relationships.join("\n")}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      currentState: {
                        ...draft.currentState,
                        relationships: event.target.value.split("\n").filter(Boolean)
                      }
                    })
                  }
                />
              </label>
              <label>
                口吻备注
                <textarea
                  value={draft.voiceNotes}
                  onChange={(event) => setDraft({ ...draft, voiceNotes: event.target.value })}
                />
              </label>
              <button className="primary-button" type="submit">
                <Save size={17} />
                保存人物卡
              </button>
            </>
          ) : (
            <div className="library-empty">还没有人物卡。</div>
          )}
        </form>
      </div>
    </section>
  );
};

const characterMatchesRole = (role: string, filter: RoleFilter): boolean => {
  if (filter === "all") {
    return true;
  }
  const normalized = role.toLowerCase();
  const roleAliases: Record<Exclude<RoleFilter, "all">, string[]> = {
    protagonist: ["protagonist", "main", "主角"],
    supporting: ["supporting", "ally", "side", "配角", "盟友"],
    antagonist: ["antagonist", "villain", "enemy", "反派", "敌人"]
  };
  return roleAliases[filter].some((alias) => normalized.includes(alias));
};
