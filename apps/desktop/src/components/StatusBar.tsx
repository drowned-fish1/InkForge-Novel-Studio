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
  const tokenEstimate = Math.ceil(words * 1.2);

  useEffect(() => {
    window.localStorage.setItem(shortcutHintStorageKey, String(hideShortcutHints));
  }, [hideShortcutHints]);

  return (
    <footer className="status-bar">
      <span>字数 {words.toLocaleString("zh-CN")}</span>
      <span>自动保存 {lastSavedAt ?? "等待写入"}</span>
      <span>当前任务 {saveState === "saving" ? "保存章节" : "写作"}</span>
      <span>Token 估算 {tokenEstimate.toLocaleString("zh-CN")}</span>
      {!hideShortcutHints ? <span className="shortcut-hints">{keybindingHints.join(" / ")}</span> : null}
      <button className="status-toggle" type="button" onClick={() => setHideShortcutHints((value) => !value)}>
        {hideShortcutHints ? "显示快捷键" : "隐藏快捷键"}
      </button>
    </footer>
  );
};
