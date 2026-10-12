import { useEffect, useState } from "react";
import { Pin } from "lucide-react";
import { useProjectStore } from "@/stores/useProjectStore";
import { useWritingReferenceStore } from "@/stores/useWritingReferenceStore";
import { referenceKey, type WritingReferenceTarget } from "@/lib/writingReferences";
import "@/features/chapters/pinnedWritingReferences.css";

export const PinWritingReferenceButton = ({
  target,
  disabled = false
}: {
  target?: WritingReferenceTarget;
  disabled?: boolean;
}) => {
  const path = useProjectStore((state) => state.project?.projectPath) ?? "";
  const preferences = useWritingReferenceStore((state) => state.projects[path]);
  const hydrate = useWritingReferenceStore((state) => state.hydrate);
  const [error, setError] = useState("");
  useEffect(() => {
    if (path) hydrate(path);
  }, [path, hydrate]);
  const pinned = target && preferences?.cards.some((card) => referenceKey(card) === referenceKey(target));
  return (
    <div className="pin-writing-reference-action">
      <button
        type="button"
        className="secondary-button compact"
        disabled={disabled || !target || !path}
        title="固定已保存的资料到写作台；表单中未保存的修改不会写入资料卡"
        onClick={() => {
          if (!target) return;
          try {
            useWritingReferenceStore.getState().pin(path, target);
            setError("");
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "固定失败。");
          }
        }}
      >
        <Pin size={14} />
        {pinned ? "已固定到写作台" : "固定到写作台"}
      </button>
      {error ? (
        <p role="alert" className="error-banner compact">
          {error}
        </p>
      ) : null}
    </div>
  );
};
