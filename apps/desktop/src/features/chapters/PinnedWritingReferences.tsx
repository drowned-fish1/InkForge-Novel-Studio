import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Pin, X } from "lucide-react";
import { useProjectStore } from "@/stores/useProjectStore";
import { useWritingReferenceStore } from "@/stores/useWritingReferenceStore";
import { referenceKey } from "@/lib/writingReferences";
import { useWritingReferenceEntries } from "@/lib/useWritingReferenceEntries";
import { WritingReferenceCard } from "./WritingReferenceCard";

export const PinnedWritingReferences = () => {
  const path = useProjectStore((state) => state.project?.projectPath) ?? "";
  const preferences = useWritingReferenceStore((state) => state.projects[path]);
  const { hydrate, activate, remove, clear, collapse } = useWritingReferenceStore();
  const { entries, ready } = useWritingReferenceEntries();
  const [error, setError] = useState("");
  useEffect(() => {
    if (path) hydrate(path);
  }, [path, hydrate]);
  if (!preferences?.cards.length) return null;
  const active = preferences.cards.find((card) => referenceKey(card) === preferences.activeKey) ?? preferences.cards[0];
  const selected = entries.find((entry) => referenceKey(entry) === referenceKey(active));
  const perform = (action: () => void) => {
    try {
      action();
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "更新固定资料失败。");
    }
  };
  return (
    <aside className={`pinned-writing-references ${preferences.collapsed ? "collapsed" : ""}`} aria-label="固定资料卡">
      <header>
        <strong>
          <Pin size={15} />
          固定资料（{preferences.cards.length}）
        </strong>
        <div>
          <button
            type="button"
            className="icon-button"
            aria-label={preferences.collapsed ? "展开固定资料卡" : "收起固定资料卡"}
            aria-expanded={!preferences.collapsed}
            onClick={() => perform(() => collapse(path, !preferences.collapsed))}
          >
            {preferences.collapsed ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="关闭全部固定资料卡"
            onClick={() => perform(() => clear(path))}
          >
            <X size={15} />
          </button>
        </div>
      </header>
      {error ? (
        <p className="error-banner" role="alert">
          {error}
        </p>
      ) : null}
      {!preferences.collapsed ? (
        <>
          <div className="pinned-reference-tabs" aria-label="选择固定资料">
            {preferences.cards.map((target) => {
              const key = referenceKey(target);
              const entry = entries.find((candidate) => referenceKey(candidate) === key);
              const title = ready ? (entry?.title ?? "资料已删除") : "读取中";
              return (
                <div key={key} className={referenceKey(active) === key ? "active" : ""}>
                  <button
                    type="button"
                    aria-pressed={referenceKey(active) === key}
                    onClick={() => perform(() => activate(path, target))}
                  >
                    {title}
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`取消固定 ${entry?.title ?? target.id}`}
                    onClick={() => perform(() => remove(path, target))}
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })}
          </div>
          <div className="pinned-reference-detail">
            {!ready ? (
              <p role="status">正在读取本项目资料…</p>
            ) : selected ? (
              <WritingReferenceCard entry={selected} />
            ) : (
              <div className="pinned-reference-missing" role="status">
                <strong>资料已删除或不可用</strong>
                <p>固定记录仍保留，可取消固定后选择其他资料。</p>
                <button
                  type="button"
                  className="secondary-button compact"
                  onClick={() => perform(() => remove(path, active))}
                >
                  移除此固定记录
                </button>
              </div>
            )}
          </div>
        </>
      ) : null}
    </aside>
  );
};
