import { MessageSquareText, PencilLine, Trash2, X } from "lucide-react";
import { useState } from "react";
import type { AgentSelectionReference } from "@/lib/agentSelection";

interface Props {
  references: AgentSelectionReference[];
  disabled: boolean;
  onCommentChange: (id: string, comment: string) => void;
  onRemove: (ids: string[]) => void;
}

export const AgentSelectionAttachments = ({ references, disabled, onCommentChange, onRemove }: Props) => {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string>();
  if (!references.length) return null;

  return (
    <section className="agent-selection-attachments" aria-label="待发送的正文引用">
      <div className="agent-selection-chip">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="agent-selection-list"
          onClick={() => setOpen((value) => !value)}
        >
          <MessageSquareText size={13} />
          {references.length} 条引用
        </button>
        <button
          type="button"
          disabled={disabled}
          aria-label="移除全部正文引用"
          onClick={() => onRemove(references.map((item) => item.id))}
        >
          <X size={13} />
        </button>
      </div>
      {open ? (
        <ol id="agent-selection-list" className="agent-selection-list">
          {references.map((reference, index) => (
            <li key={reference.id}>
              <header>
                <span>
                  {index + 1}. 所选文本 · {reference.chapterTitle}
                </span>
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`编辑引用 ${index + 1} 的批注`}
                  aria-expanded={editingId === reference.id}
                  onClick={() => setEditingId((value) => (value === reference.id ? undefined : reference.id))}
                >
                  <PencilLine size={13} />
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`移除引用 ${index + 1}`}
                  onClick={() => onRemove([reference.id])}
                >
                  <Trash2 size={13} />
                </button>
              </header>
              <blockquote>{reference.quote}</blockquote>
              {editingId === reference.id ? (
                <label className="agent-selection-comment">
                  对这段文字的要求
                  <textarea
                    autoFocus
                    aria-label={`引用 ${index + 1} 的批注`}
                    disabled={disabled}
                    value={reference.comment}
                    placeholder="例如：保留剧情，让对白更自然…"
                    onChange={(event) => onCommentChange(reference.id, event.target.value)}
                    onKeyDown={(event) => event.stopPropagation()}
                  />
                  <button className="secondary-button compact" type="button" onClick={() => setEditingId(undefined)}>
                    完成
                  </button>
                </label>
              ) : reference.comment ? (
                <p className="agent-selection-saved-comment">{reference.comment}</p>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
};
