import { useDeferredValue, useMemo, useState } from "react";
import { BookOpen, Pin, Search, X } from "lucide-react";
import { useProjectStore } from "@/stores/useProjectStore";
import { useWritingReferenceStore } from "@/stores/useWritingReferenceStore";
import { useWritingReferenceEntries } from "@/lib/useWritingReferenceEntries";
import { findWritingReferences, referenceKey, type WritingReferenceTarget } from "@/lib/writingReferences";
import { WritingReferenceCard } from "./WritingReferenceCard";
export type { WritingReferenceTarget } from "@/lib/writingReferences";

interface Props {
  target?: WritingReferenceTarget;
  initialQuery?: string;
  onClose: () => void;
  onPinned?: () => void;
}
export const WritingReferencePanel = ({ target, initialQuery = "", onClose, onPinned }: Props) => {
  const path = useProjectStore((state) => state.project?.projectPath) ?? "";
  const { entries, ready } = useWritingReferenceEntries();
  const [query, setQuery] = useState(target ? "" : initialQuery);
  const [selectedKey, setSelectedKey] = useState(target ? referenceKey(target) : "");
  const [error, setError] = useState("");
  const deferredQuery = useDeferredValue(query);
  const { matches: filtered, ambiguous } = useMemo(
    () => findWritingReferences(entries, deferredQuery),
    [entries, deferredQuery]
  );
  const selected = selectedKey
    ? filtered.find((entry) => referenceKey(entry) === selectedKey)
    : ambiguous
      ? undefined
      : filtered[0];
  return (
    <section
      className="writing-reference-panel"
      aria-label="写作资料速查"
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <header>
        <strong>
          <BookOpen size={15} />
          资料速查
        </strong>
        <button type="button" className="icon-button" aria-label="关闭资料速查并继续写作" onClick={onClose}>
          <X size={16} />
        </button>
      </header>
      <label className="writing-reference-search">
        <Search size={14} />
        <input
          autoFocus
          aria-label="搜索写作资料"
          placeholder="搜索人物、别名、地点或设定"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelectedKey("");
          }}
        />
      </label>
      {error ? (
        <p className="error-banner" role="alert">
          {error}
        </p>
      ) : null}
      <div className="writing-reference-content">
        <div className="writing-reference-results" aria-label="速查条目">
          {filtered.slice(0, 40).map((entry) => (
            <button
              type="button"
              key={referenceKey(entry)}
              aria-pressed={selected === entry}
              onClick={() => setSelectedKey(referenceKey(entry))}
            >
              <small>{entry.type}</small>
              <span>{entry.title}</span>
            </button>
          ))}
          {!ready ? (
            <p role="status">正在读取本项目资料…</p>
          ) : !filtered.length ? (
            <p role="status">没有匹配资料，可换个关键词。</p>
          ) : null}
          {filtered.length > 40 ? <small>输入关键词缩小范围。</small> : null}
        </div>
        {selected ? (
          <WritingReferenceCard entry={selected} />
        ) : ambiguous && ready ? (
          <p role="status">多个条目使用同一名称或别名，请在列表选择一张资料卡。</p>
        ) : selectedKey && ready ? (
          <p role="status">这条资料已删除或不再可用。</p>
        ) : null}
      </div>
      <footer>
        {selected ? (
          <button
            type="button"
            className="primary-button compact"
            onClick={() => {
              try {
                useWritingReferenceStore.getState().pin(path, selected);
                setError("");
                (onPinned ?? onClose)();
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : "固定失败。");
              }
            }}
          >
            <Pin size={14} />
            固定这张资料卡
          </button>
        ) : null}
        <button type="button" className="secondary-button compact" onClick={onClose}>
          继续写作
        </button>
      </footer>
    </section>
  );
};
