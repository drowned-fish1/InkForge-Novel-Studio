export const sidebarShortcutModules = [
  { key: "1", module: "chapters", label: "章节" },
  { key: "2", module: "characters", label: "人物" },
  { key: "3", module: "world", label: "世界" },
  { key: "4", module: "overview", label: "总览" },
  { key: "5", module: "timeline", label: "时间线" },
  { key: "6", module: "clues", label: "伏笔" },
  { key: "7", module: "terms", label: "术语" }
] as const;

export const keybindingHints = [
  "Ctrl+S 保存",
  "Ctrl+N 新章",
  "Ctrl+Shift+N 新卷",
  "Ctrl+E 导出 MD",
  "Ctrl+B 专注",
  "Ctrl+1~7 模块",
  "Esc 关闭/退出"
];

interface KeybindingActions {
  save: () => void;
  createChapter: () => void;
  createVolume: () => void;
  exportMarkdown: () => void;
  toggleFocusMode: () => void;
  exitFocusMode: () => void;
  closeSettings: () => boolean;
  switchModule: (module: string) => void;
}

const isControlKey = (event: KeyboardEvent): boolean => event.ctrlKey || event.metaKey;

const isPlainShortcut = (event: KeyboardEvent): boolean => isControlKey(event) && !event.altKey;

export const createKeybindingHandler = (actions: KeybindingActions) => (event: KeyboardEvent) => {
  if (event.repeat) {
    return;
  }

  const key = event.key.toLowerCase();

  if (event.key === "Escape") {
    const settingsClosed = actions.closeSettings();
    if (settingsClosed) {
      event.preventDefault();
      return;
    }
    actions.exitFocusMode();
    event.preventDefault();
    return;
  }

  if (!isPlainShortcut(event)) {
    return;
  }

  if (key === "s" && !event.shiftKey) {
    event.preventDefault();
    actions.save();
    return;
  }

  if (key === "n") {
    event.preventDefault();
    if (event.shiftKey) {
      actions.createVolume();
      return;
    }
    actions.createChapter();
    return;
  }

  if (key === "e" && !event.shiftKey) {
    event.preventDefault();
    actions.exportMarkdown();
    return;
  }

  if (key === "b" && !event.shiftKey) {
    event.preventDefault();
    actions.toggleFocusMode();
    return;
  }

  if (!event.shiftKey) {
    const shortcut = sidebarShortcutModules.find((item) => item.key === event.key);
    if (shortcut) {
      event.preventDefault();
      actions.switchModule(shortcut.module);
    }
  }
};
