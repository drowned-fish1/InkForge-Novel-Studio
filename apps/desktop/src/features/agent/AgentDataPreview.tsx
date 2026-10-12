import { MapPin, Target, Timer, Users } from "lucide-react";
import type { AgentDataProposal } from "@inkforge/schemas";
import type { ReactNode } from "react";

type DataRecord = Record<string, unknown>;

const fieldLabels: Record<string, string> = {
  outline: "完整大纲",
  premise: "作品前提",
  mainConflict: "主冲突",
  endingDirection: "结局方向",
  volumes: "分卷",
  chapters: "章节",
  number: "章序",
  targetWords: "目标字数",
  title: "标题",
  name: "名称",
  role: "角色定位",
  type: "设定类型",
  aliases: "别名",
  tags: "标签",
  profile: "人物档案",
  age: "年龄",
  identity: "身份",
  motivation: "动机",
  personality: "性格",
  currentState: "当前状态",
  arc: "所属篇章",
  powerLevel: "能力层级",
  location: "地点",
  relationships: "人物关系",
  secrets: "秘密",
  voiceNotes: "语言风格",
  category: "分类",
  definition: "定义",
  locked: "已锁定",
  plantedChapterId: "埋设章节",
  relatedCharacters: "相关人物",
  expectedPayoff: "预期回收",
  status: "状态",
  notes: "备注",
  participants: "参与者",
  summary: "事件摘要",
  content: "详细设定",
  time: "时间",
  goal: "场景目标",
  conflict: "核心冲突",
  outcome: "结果与钩子",
  beats: "关键节拍",
  beat: "节拍",
  requiredCharacters: "出场人物",
  worldRefs: "关联设定",
  clueRefs: "关联伏笔",
  decisionPoints: "决策点",
  question: "决策问题",
  options: "可选方向",
  label: "选项",
  consequence: "影响",
  selectedOptionId: "已选方向",
  povCharacterId: "视角人物",
  tension: "张力",
  linkedChapterId: "关联章节",
  actTitle: "目标幕",
  premiseShift: "走向假设"
};

const hiddenFields = new Set(["schemaVersion", "id", "chapterId", "order", "file", "actId"]);

const isRecord = (value: unknown): value is DataRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasValue = (value: unknown): boolean => {
  if (value === null || value === undefined || value === "") {
    return false;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (isRecord(value)) {
    return Object.entries(value).some(([key, item]) => !hiddenFields.has(key) && hasValue(item));
  }
  return true;
};

const labelFor = (key: string): string =>
  fieldLabels[key] ??
  key
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replace(/[_-]+/gu, " ")
    .trim();

const renderValue = (value: unknown, path: string): ReactNode => {
  if (typeof value === "boolean") {
    return value ? "是" : "否";
  }
  if (typeof value === "number" || typeof value === "string") {
    return String(value);
  }
  if (Array.isArray(value)) {
    if (value.every((item) => !isRecord(item))) {
      return (
        <div className="agent-data-tags">
          {value.map((item, index) => (
            <span key={`${path}-${index}`}>{String(item)}</span>
          ))}
        </div>
      );
    }
    return (
      <div className="agent-data-nested-list">
        {value.map((item, index) =>
          isRecord(item) ? <DataFields data={item} key={`${path}-${index}`} path={`${path}-${index}`} /> : null
        )}
      </div>
    );
  }
  if (isRecord(value)) {
    return <DataFields data={value} path={path} />;
  }
  return null;
};

const DataFields = ({ data, path }: { data: DataRecord; path: string }) => {
  const entries = Object.entries(data).filter(([key, value]) => !hiddenFields.has(key) && hasValue(value));
  if (!entries.length) {
    return <span className="agent-data-empty">暂无补充信息</span>;
  }
  return (
    <dl className="agent-data-fields">
      {entries.map(([key, value]) => (
        <div className={isRecord(value) || (Array.isArray(value) && value.some(isRecord)) ? "wide" : ""} key={key}>
          <dt>{labelFor(key)}</dt>
          <dd>{renderValue(value, `${path}-${key}`)}</dd>
        </div>
      ))}
    </dl>
  );
};

const ScenePreview = ({ payload }: { payload: DataRecord }) => {
  const scenes = Array.isArray(payload.scenes) ? payload.scenes.filter(isRecord) : [];
  return (
    <div className="agent-scene-preview-list">
      {scenes.map((scene, index) => (
        <article className="agent-scene-preview" key={String(scene.id ?? index)}>
          <header>
            <b>{index + 1}</b>
            <strong>{String(scene.title || `场景 ${index + 1}`)}</strong>
          </header>
          {scene.location || scene.time ? (
            <div className="agent-scene-meta">
              {scene.location ? (
                <span>
                  <MapPin size={11} />
                  {String(scene.location)}
                </span>
              ) : null}
              {scene.time ? (
                <span>
                  <Timer size={11} />
                  {String(scene.time)}
                </span>
              ) : null}
            </div>
          ) : null}
          <div className="agent-scene-storyline">
            {scene.goal ? (
              <p>
                <Target size={12} />
                <span>
                  <small>目标</small>
                  {String(scene.goal)}
                </span>
              </p>
            ) : null}
            {scene.conflict ? (
              <p>
                <b>冲</b>
                <span>
                  <small>冲突</small>
                  {String(scene.conflict)}
                </span>
              </p>
            ) : null}
            {scene.outcome ? (
              <p>
                <b>果</b>
                <span>
                  <small>结果与钩子</small>
                  {String(scene.outcome)}
                </span>
              </p>
            ) : null}
          </div>
          {Array.isArray(scene.requiredCharacters) && scene.requiredCharacters.length ? (
            <div className="agent-scene-characters">
              <Users size={12} />
              {scene.requiredCharacters.map((character) => (
                <span key={String(character)}>{String(character)}</span>
              ))}
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
};

const beatTypeLabels: Record<string, string> = {
  setup: "铺垫",
  inciting: "激励事件",
  rising: "推进",
  midpoint: "中点",
  climax: "高潮",
  resolution: "收束"
};

const BeatPreview = ({ payload }: { payload: DataRecord }) => {
  const beats = Array.isArray(payload.beats) ? payload.beats.filter(isRecord) : [];
  return (
    <div className="agent-scene-preview-list">
      {typeof payload.actTitle === "string" && payload.actTitle ? (
        <div className="agent-data-tags">
          <span>目标幕：{payload.actTitle}</span>
        </div>
      ) : null}
      {beats.map((beat, index) => {
        const type = beat.type;
        const tension = beat.tension;
        const rest = Object.fromEntries(
          Object.entries(beat).filter(([key]) => !["title", "type", "tension", "id"].includes(key))
        );
        return (
          <article className="agent-scene-preview" key={String(beat.id ?? index)}>
            <header>
              <b>{index + 1}</b>
              <strong>{String(beat.title || `节拍 ${index + 1}`)}</strong>
            </header>
            {type !== undefined || tension !== undefined ? (
              <div className="agent-data-tags">
                {type !== undefined ? <span>{beatTypeLabels[String(type)] ?? String(type)}</span> : null}
                {tension !== undefined ? <span>张力 {String(tension)}</span> : null}
              </div>
            ) : null}
            <DataFields data={rest} path={`beat-${index}`} />
          </article>
        );
      })}
    </div>
  );
};

export const AgentDataPreview = ({ proposal }: { proposal: AgentDataProposal }) => {
  const payload = proposal.payload as DataRecord;
  if (proposal.entityType === "project_data") {
    const changes = Array.isArray(payload.changes) ? payload.changes.filter(isRecord) : [];
    const before = Array.isArray(payload.before) ? payload.before.filter(isRecord) : [];
    return (
      <div className="agent-data-preview">
        <p>基于资料版本 {String(payload.expectedRevision)}；未列出的栏目保持原样。</p>
        {changes.map((change) => (
          <article key={String(change.key)}>
            <strong>
              {change.operation === "delete" ? "删除" : "保存"}：{String(change.key)}
            </strong>
            {before.some((entry) => entry.key === change.key) ? (
              <details>
                <summary>原内容</summary>
                <pre>{JSON.stringify(before.find((entry) => entry.key === change.key)?.content, null, 2)}</pre>
              </details>
            ) : (
              <small>新增栏目</small>
            )}
            {change.operation !== "delete" ? <pre>{JSON.stringify(change.content, null, 2)}</pre> : null}
            {change.sourceChapterId ? <p>来源章节：{String(change.sourceChapterId)}</p> : null}
            {Array.isArray(change.sources)
              ? change.sources.filter(isRecord).map((source, index) => (
                  <blockquote key={index}>
                    [{String(source.chapterId)}] {String(source.excerpt)}
                  </blockquote>
                ))
              : null}
          </article>
        ))}
      </div>
    );
  }
  if (proposal.entityType === "scene") {
    return <ScenePreview payload={payload} />;
  }
  if (proposal.entityType === "beat") {
    return <BeatPreview payload={payload} />;
  }
  const entity = isRecord(payload.entity) ? payload.entity : payload;
  return <DataFields data={entity} path={proposal.entityType} />;
};
