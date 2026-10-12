import { useProjectStore } from "@/stores/useProjectStore";
import type { WritingReferenceEntry } from "@/lib/writingReferences";

export const WritingReferenceCard = ({ entry }: { entry: WritingReferenceEntry }) => {
  const openEntitySearchResult = useProjectStore((state) => state.openEntitySearchResult);
  return (
    <article className="writing-reference-card" aria-label="资料卡详情">
      <small className="writing-reference-kind">{entry.type} · 资料库已保存内容</small>
      <h3>{entry.title}</h3>
      {entry.aliases.length ? <p className="muted">{entry.aliases.join("、")}</p> : null}
      <dl>
        {entry.fields
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
      </dl>
      {!entry.fields.some(([, value]) => value) ? <p className="muted">这条资料暂未填写详细内容。</p> : null}
      {entry.kind === "character" ? (
        <p className="writing-reference-state-note">动态状态为资料库当前记录，未按正在写的章节回溯。</p>
      ) : null}
      <button
        type="button"
        className="tiny-text-button"
        onClick={() =>
          openEntitySearchResult(
            { kind: entry.kind, id: entry.id, title: entry.title, offset: 0, matchLength: 0, snippet: "" },
            entry.title
          )
        }
      >
        打开完整资料
      </button>
    </article>
  );
};
