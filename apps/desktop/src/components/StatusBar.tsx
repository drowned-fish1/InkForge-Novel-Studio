import { useEffect, useState } from "react";
import { keybindingHints } from "@/lib/keybindings";
import { countCjkAwareWords } from "@/lib/textMetrics";
import { useProjectStore } from "@/stores/useProjectStore";

const shortcutHintStorageKey = "inkforge.shortcutHintsHidden";

export const StatusBar = () => {
  const current = useProjectStore((state) => state.current);
  const lastSavedAt = useProjectStore((state) => state.lastSavedAt);
  const saveState = useProjectStore((state) => state.saveState);
  const [hideShortcutHints, setHideShortcutHints] = useState(
    () => window.localStorage.getItem(shortcutHintStorageKey) === "true"
  );
  const words = countCjkAwareWords(current?.content ?? "");

  useEffect(() => {
    window.localStorage.setItem(shortcutHintStorageKey, String(hideShortcutHints));
  }, [hideShortcutHints]);

  const saveLabel =
    saveState === "saving"
      ? "正在保存"
      : saveState === "dirty"
        ? "有未保存改动"
        : saveState === "error"
          ? "保存失败"
          : lastSavedAt
            ? `已保存 ${lastSavedAt}`
            : "已保存";

  return (
    <footer className="status-bar">
      <span>本章 {words.toLocaleString("zh-CN")} 字</span>
      <span className={`status-save-state ${saveState}`} aria-live="polite">
        {saveLabel}
      </span>
      {!hideShortcutHints ? <span className="shortcut-hints">{keybindingHints.join(" / ")}</span> : null}
      <button className="status-toggle" type="button" onClick={() => setHideShortcutHints((value) => !value)}>
        {hideShortcutHints ? "显示快捷键" : "隐藏快捷键"}
      </button>
    </footer>
  );
};
