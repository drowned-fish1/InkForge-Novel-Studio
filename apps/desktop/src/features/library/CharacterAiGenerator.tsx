import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Loader2, Sparkles, X } from "lucide-react";
import type { Character } from "@inkforge/schemas";
import { bridge } from "@/lib/browserBridge";
import {
  applyGeneratedCharacter,
  characterNameTaken,
  nameConstraintIssue,
  parseCharacterGeneration,
  type GeneratedCharacter,
  type NameCandidate
} from "@/lib/characterGeneration";
import { useProjectStore } from "@/stores/useProjectStore";
import { useLibraryStore } from "@/stores/useLibraryStore";

interface Props {
  draft: Character;
  setDraft: Dispatch<SetStateAction<Character | undefined>>;
  disabled: boolean;
  onClose: () => void;
}

export const CharacterAiGenerator = ({ draft, setDraft, disabled, onClose }: Props) => {
  const project = useProjectStore((state) => state.project)!;
  const characters = useLibraryStore((state) => state.characters);
  const worldEntries = useLibraryStore((state) => state.worldEntries);
  const [requirement, setRequirement] = useState("");
  const [surname, setSurname] = useState("");
  const [gender, setGender] = useState("不限");
  const [culture, setCulture] = useState("贴合本书设定");
  const [length, setLength] = useState("不限");
  const [avoid, setAvoid] = useState("");
  const [names, setNames] = useState<NameCandidate[]>([]);
  const [card, setCard] = useState<GeneratedCharacter>();
  const [chosenName, setChosenName] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const request = useRef<AbortController | null>(null);
  const namingConstraints = { surname, length: Number(length.match(/\d/u)?.[0] ?? 0), avoid };
  const nameProblem = (name: string) =>
    characterNameTaken(name, characters, draft.id)
      ? "与已有姓名／别名重复"
      : nameConstraintIssue(name, namingConstraints);
  useEffect(() => () => request.current?.abort(), []);

  const generate = async (fullCard: boolean) => {
    if (request.current || disabled) return;
    const controller = new AbortController();
    request.current = controller;
    setRunning(true);
    setError("");
    setNotice("");
    try {
      const response = await bridge.runAiTask(
        {
          projectPath: project.projectPath,
          task: fullCard ? "character-generate" : "character-names",
          providerRole: "planner",
          chapterTitle: project.meta.title,
          chapterGoal: [
            project.outline.premise,
            project.outline.mainConflict,
            `题材：${project.meta.genre.join("、")}`
          ].join("\n"),
          recentText: JSON.stringify(draft),
          instruction: [
            requirement.trim(),
            `姓氏：${surname.trim() || "不限"}；性别倾向：${gender}；命名文化：${culture}；姓名长度：${length}；避用字或名字：${avoid.trim() || "无"}`
          ].join("\n"),
          characters: characters
            .filter((character) => character.id !== draft.id)
            .slice(0, 200)
            .map(
              (character) =>
                `${character.name}（别名：${character.aliases.join("、")}；身份：${character.profile.identity.slice(0, 120)}）`
            ),
          worldFacts: worldEntries
            .slice(0, 12)
            .map((entry) => `${entry.title}：${(entry.summary || entry.content).slice(0, 200)}`),
          style: project.meta.writingPreferences.style
        },
        controller.signal
      );
      if (controller.signal.aborted) return;
      const parsed = parseCharacterGeneration(response.text, fullCard);
      setNames(parsed.names);
      setCard(fullCard ? parsed.character : undefined);
      const recommended = parsed.character?.name;
      setChosenName(
        recommended && !nameProblem(recommended)
          ? recommended
          : (parsed.names.find((candidate) => !nameProblem(candidate.name))?.name ?? "")
      );
      setNotice(`由 ${response.model} 生成；结果待采用。`);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : "AI 生成失败，请检查模型设置。");
    } finally {
      if (request.current === controller) {
        request.current = null;
        setRunning(false);
      }
    }
  };
  const adoptName = (name: string) => {
    if (nameConstraintIssue(name, namingConstraints)) {
      setError("该候选不符合当前起名条件，请换一个候选或调整条件。");
      return;
    }
    if (characterNameTaken(name, useLibraryStore.getState().characters, draft.id)) {
      setError("这个名字与已有姓名或别名重复，请选择其他候选。");
      return;
    }
    setChosenName(name);
    setDraft((current) => (current ? { ...current, name } : current));
    setNotice(`「${name}」已填入姓名，保存人物卡后生效。`);
  };
  const adoptCard = (fillEmpty: boolean) => {
    if (!card) return;
    const name = chosenName || card.name;
    const finalName = fillEmpty && draft.name.trim() && draft.name !== "新角色" ? draft.name : name;
    if (finalName === name && nameConstraintIssue(finalName, namingConstraints)) {
      setError("推荐姓名不符合当前起名条件，请先采用一个合适的候选。");
      return;
    }
    if (characterNameTaken(finalName, useLibraryStore.getState().characters, draft.id)) {
      setError("推荐姓名与已有角色重复，请先选一个其他名字。");
      return;
    }
    setDraft((current) => (current ? applyGeneratedCharacter(current, { ...card, name }, fillEmpty) : current));
    setNotice(fillEmpty ? "已补入空字段，请检查并保存人物卡。" : "整卡已填入表单，请检查并保存人物卡。");
  };

  return (
    <section
      className="character-ai-generator"
      aria-label="AI 人物设计"
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault();
      }}
    >
      <header>
        <div>
          <h3>
            <Sparkles size={17} /> AI 人物卡与起名
          </h3>
          <p>使用设置中的规划模型，结合本书设定生成候选。采用后仍可在表单中修改。</p>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label="关闭 AI 人物设计"
          onClick={() => {
            request.current?.abort();
            onClose();
          }}
        >
          <X size={17} />
        </button>
      </header>
      <fieldset disabled={running || disabled}>
        <div className="character-naming-fields">
          <label>
            指定姓氏
            <input
              aria-label="起名姓氏"
              value={surname}
              maxLength={20}
              placeholder="可留空，如：顾、司徒"
              onChange={(event) => setSurname(event.target.value)}
            />
          </label>
          <label>
            性别倾向
            <select aria-label="起名性别倾向" value={gender} onChange={(event) => setGender(event.target.value)}>
              {["不限", "男性", "女性", "中性"].map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label>
            命名文化
            <select aria-label="命名文化" value={culture} onChange={(event) => setCulture(event.target.value)}>
              {["贴合本书设定", "现代中文", "古风中文", "西方奇幻", "日式", "自创异世界"].map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label>
            姓名长度
            <select aria-label="姓名长度" value={length} onChange={(event) => setLength(event.target.value)}>
              {["不限", "全名 2 字", "全名 3 字", "全名 4 字"].map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
        </div>
        <label>
          避用字／名字
          <input
            aria-label="起名避用字"
            value={avoid}
            maxLength={200}
            placeholder="例如：轩、辰，避免与主角谐音"
            onChange={(event) => setAvoid(event.target.value)}
          />
        </label>
        <label>
          人物设想与命名要求
          <textarea
            aria-label="AI 人物要求"
            rows={3}
            value={requirement}
            maxLength={4000}
            placeholder="例如：外冷内热的女剑修，姓顾，名字简洁有力量感；与主角亦敌亦友。"
            onChange={(event) => setRequirement(event.target.value)}
          />
        </label>
        <div className="character-ai-actions">
          <button className="secondary-button" type="button" onClick={() => void generate(false)}>
            <Sparkles size={14} />
            只生成名字
          </button>
          <button className="primary-button" type="button" onClick={() => void generate(true)}>
            <Sparkles size={14} />
            生成整张人物卡
          </button>
        </div>
      </fieldset>
      {running ? (
        <div className="character-ai-actions" role="status">
          <Loader2 size={16} className="spinning" />
          正在生成人物设计…
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              request.current?.abort();
              setNotice("已停止生成；之前的候选仍可采用。");
            }}
          >
            停止生成
          </button>
        </div>
      ) : null}
      {error ? (
        <p className="error-banner" role="alert">
          {error}
        </p>
      ) : null}
      {names.length ? (
        <div className="character-name-candidates" aria-label="名字候选">
          {names.map((candidate) => {
            const problem = nameProblem(candidate.name);
            return (
              <article key={candidate.name} className={chosenName === candidate.name ? "chosen" : ""}>
                <strong>{candidate.name}</strong>
                <p>{candidate.meaning}</p>
                <small>{candidate.fit}</small>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={disabled || running || Boolean(problem)}
                  onClick={() => adoptName(candidate.name)}
                >
                  {problem
                    ? problem
                    : chosenName === candidate.name && draft.name === candidate.name
                      ? "已填入姓名"
                      : "采用这个名字"}
                </button>
              </article>
            );
          })}
        </div>
      ) : null}
      {card ? (
        <div className="character-card-preview">
          <h4>人物卡预览 · {chosenName || card.name}</h4>
          <dl>
            {[
              ["身份", card.profile.identity],
              ["年龄", card.profile.age],
              ["性格", card.profile.personality],
              ["动机", card.profile.motivation],
              ["成长线", card.currentState.arc],
              ["能力", card.currentState.powerLevel],
              ["位置", card.currentState.location],
              ["关系", card.currentState.relationships.join("；")],
              ["秘密", card.currentState.secrets.join("；")],
              ["口吻", card.voiceNotes],
              ["标签", card.tags.join("、")]
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value || "—"}</dd>
              </div>
            ))}
          </dl>
          <div className="character-ai-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={disabled || running}
              onClick={() => adoptCard(true)}
            >
              仅补空字段
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={disabled || running}
              onClick={() => adoptCard(false)}
            >
              用整卡替换表单
            </button>
          </div>
        </div>
      ) : null}
      <p className="editor-feedback" role="status" aria-live="polite">
        {notice}
      </p>
    </section>
  );
};
