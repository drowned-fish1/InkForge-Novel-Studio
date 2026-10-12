import { useEffect, useRef, useState } from "react";
import { Link2, Loader2, Replace, Trash2, Unlink, X } from "lucide-react";
import type { StoryEntityRef, StoryReferenceHit } from "@inkforge/schemas";
import { useLibraryStore } from "@/stores/useLibraryStore";

const sourceKindLabels: Record<StoryReferenceHit["sourceKind"], string> = {
  character: "人物",
  world: "世界观",
  timeline: "事件",
  clue: "伏笔",
  conflict: "冲突",
  chapter: "章节"
};

interface EntityDeleteDialogProps {
  target: StoryEntityRef;
  title: string;
  onClose: () => void;
  onDeleted: () => void;
}

export const EntityDeleteDialog = ({ target, title, onClose, onDeleted }: EntityDeleteDialogProps) => {
  const findEntityReferences = useLibraryStore((state) => state.findEntityReferences);
  const deleteStoryEntity = useLibraryStore((state) => state.deleteStoryEntity);
  const [references, setReferences] = useState<StoryReferenceHit[] | undefined>();
  const [replacement, setReplacement] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setReferences(undefined);
    setError("");
    void findEntityReferences(target)
      .then((hits) => {
        if (!cancelled) setReferences(hits);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "读取引用失败");
      });
    return () => {
      cancelled = true;
    };
  }, [target.kind, target.id]);

  const run = async (mode: "force" | "unlink" | "replace") => {
    setBusy(true);
    setError("");
    try {
      await deleteStoryEntity(target, mode, mode === "replace" ? replacement : undefined);
      onDeleted();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="entity-delete-backdrop"
      aria-label={`删除 ${title}`}
      onKeyDown={(event) => event.stopPropagation()}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <section className="entity-delete-dialog">
        <header>
          <strong>
            <Trash2 size={15} />
            删除「{title}」
          </strong>
          <button className="icon-button" type="button" aria-label="取消删除" disabled={busy} onClick={onClose}>
            <X size={15} />
          </button>
        </header>

        {error ? (
          <div className="error-banner" role="alert">
            {error}
          </div>
        ) : null}

        {references === undefined ? (
          error ? (
            <p className="muted">引用检查未完成，请关闭后重试。</p>
          ) : (
            <p className="muted">
              <Loader2 className="spinning" size={14} /> 正在检查引用…
            </p>
          )
        ) : references.length ? (
          <>
            <p className="entity-delete-warning">
              <Link2 size={14} />
              该资料被 {references.length} 处引用。直接删除会留下失效引用，请选择处理方式。
            </p>
            <ul className="entity-reference-list">
              {references.slice(0, 12).map((hit, index) => (
                <li key={`${hit.sourceKind}-${hit.sourceId}-${index}`}>
                  <em>{sourceKindLabels[hit.sourceKind]}</em>
                  <strong>{hit.sourceTitle}</strong>
                  <span>
                    {hit.field}：{hit.matched}
                  </span>
                </li>
              ))}
              {references.length > 12 ? <li className="muted">…以及另外 {references.length - 12} 处</li> : null}
            </ul>
            <div className="entity-delete-actions">
              <button
                className="secondary-button compact"
                type="button"
                disabled={busy}
                onClick={() => void run("unlink")}
              >
                <Unlink size={14} />
                解除全部引用后删除
              </button>
              <div className="entity-replace-row">
                <input
                  aria-label="替换引用名称"
                  placeholder="替换为其他名称…"
                  value={replacement}
                  onChange={(event) => setReplacement(event.target.value)}
                />
                <button
                  className="secondary-button compact"
                  type="button"
                  disabled={busy || !replacement.trim()}
                  onClick={() => void run("replace")}
                >
                  <Replace size={14} />
                  替换并删除
                </button>
              </div>
              <button className="tiny-text-button" type="button" disabled={busy} onClick={onClose}>
                取消
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="muted">没有发现其他资料引用它，可以安全删除。</p>
            <div className="entity-delete-actions">
              <button
                className="primary-button compact danger"
                type="button"
                disabled={busy}
                onClick={() => void run("force")}
              >
                {busy ? <Loader2 className="spinning" size={14} /> : <Trash2 size={14} />}
                确认删除
              </button>
              <button className="tiny-text-button" type="button" disabled={busy} onClick={onClose}>
                取消
              </button>
            </div>
          </>
        )}
      </section>
    </dialog>
  );
};
