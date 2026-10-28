import { GripVertical, Link2, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useProjectStore } from "@/stores/useProjectStore";
import { useWritingSessionStore } from "@/stores/useWritingSessionStore";
import { useLibraryStore } from "@/stores/useLibraryStore";

export const ScenePlanner = () => {
  const current = useProjectStore((state) => state.current);
  const characters = useLibraryStore((state) => state.characters);
  const scenePlans = useWritingSessionStore((state) => state.scenePlans);
  const session = useWritingSessionStore((state) => state.session);
  const hydrateScenePlans = useWritingSessionStore((state) => state.hydrateScenePlans);
  const addScenePlan = useWritingSessionStore((state) => state.addScenePlan);
  const updateScenePlan = useWritingSessionStore((state) => state.updateScenePlan);
  const deleteScenePlan = useWritingSessionStore((state) => state.deleteScenePlan);
  const moveScenePlan = useWritingSessionStore((state) => state.moveScenePlan);
  const [activeSceneId, setActiveSceneId] = useState<string>();

  useEffect(() => {
    hydrateScenePlans();
  }, [current?.plan.id, hydrateScenePlans]);

  useEffect(() => {
    setActiveSceneId((currentId) =>
      currentId && scenePlans.some((scene) => scene.id === currentId) ? currentId : scenePlans[0]?.id
    );
  }, [scenePlans]);

  if (!current) {
    return null;
  }

  const activeScene = scenePlans.find((scene) => scene.id === activeSceneId);
  const completedSceneIds = new Set(session?.drafts.map((draft) => draft.sceneId) ?? []);

  return (
    <section className="scene-planner" data-testid="scene-planner">
      <div className="scene-planner-header">
        <div>
          <span className="crumb">场景规划</span>
          <strong>{scenePlans.length} 个场景</strong>
        </div>
        <button className="secondary-button compact" type="button" onClick={addScenePlan}>
          <Plus size={15} />
          新场景
        </button>
      </div>

      <div className="scene-card-list">
        {scenePlans.map((scene, index) => (
          <article
            className={`scene-card ${scene.id === activeSceneId ? "active" : ""} ${completedSceneIds.has(scene.id) ? "done" : ""}`}
            draggable
            key={scene.id}
            onClick={() => setActiveSceneId(scene.id)}
            onDragStart={(event) => {
              event.dataTransfer.setData("text/plain", scene.id);
              event.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const dragged = event.dataTransfer.getData("text/plain");
              if (dragged && dragged !== scene.id) {
                moveScenePlan(dragged, index);
              }
            }}
          >
            <div className="scene-card-top">
              <GripVertical size={14} />
              <span>{index + 1}</span>
              <strong>{scene.title}</strong>
              <small>{completedSceneIds.has(scene.id) ? "完成" : "待写"}</small>
            </div>
            <p>{scene.goal || scene.conflict || "补充场景目标"}</p>
            {index < scenePlans.length - 1 ? (
              <div className="scene-hook">
                <Link2 size={13} />
                {scene.outcome || "钩子连接下一场"}
              </div>
            ) : null}
          </article>
        ))}
      </div>

      {activeScene ? (
        <div className="scene-edit-grid">
          <label>
            标题
            <input
              value={activeScene.title}
              onChange={(event) => updateScenePlan(activeScene.id, { title: event.target.value })}
            />
          </label>
          <label>
            地点
            <input
              value={activeScene.location}
              onChange={(event) => updateScenePlan(activeScene.id, { location: event.target.value })}
            />
          </label>
          <label>
            视角人物
            <select
              value={activeScene.povCharacterId ?? ""}
              onChange={(event) => updateScenePlan(activeScene.id, { povCharacterId: event.target.value || undefined })}
            >
              <option value="">未标注视角</option>
              {activeScene.povCharacterId &&
              !characters.some((character) => character.id === activeScene.povCharacterId) ? (
                <option value={activeScene.povCharacterId}>失效 / 旧引用：{activeScene.povCharacterId}</option>
              ) : null}
              {characters.map((character) => (
                <option key={character.id} value={character.id}>
                  {character.name}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="scene-character-picker">
            <legend>场景人物</legend>
            {characters.length ? (
              characters.map((character) => (
                <label key={character.id}>
                  <input
                    type="checkbox"
                    checked={
                      activeScene.requiredCharacters.includes(character.id) ||
                      activeScene.requiredCharacters.includes(character.name)
                    }
                    onChange={(event) => {
                      const retained = activeScene.requiredCharacters.filter(
                        (value) => value !== character.id && value !== character.name
                      );
                      updateScenePlan(activeScene.id, {
                        requiredCharacters: event.target.checked ? [...retained, character.id] : retained
                      });
                    }}
                  />
                  {character.name}
                </label>
              ))
            ) : (
              <small>请先在人物库添加人物。</small>
            )}
          </fieldset>
          <label className="wide">
            目标
            <textarea
              value={activeScene.goal}
              onChange={(event) => updateScenePlan(activeScene.id, { goal: event.target.value })}
            />
          </label>
          <label>
            冲突
            <textarea
              value={activeScene.conflict}
              onChange={(event) => updateScenePlan(activeScene.id, { conflict: event.target.value })}
            />
          </label>
          <label>
            结果 / 钩子
            <textarea
              value={activeScene.outcome}
              onChange={(event) => updateScenePlan(activeScene.id, { outcome: event.target.value })}
            />
          </label>
          <button
            className="tiny-text-button danger-text"
            type="button"
            onClick={() => deleteScenePlan(activeScene.id)}
          >
            <Trash2 size={14} />
            删除当前场景
          </button>
        </div>
      ) : null}
    </section>
  );
};
