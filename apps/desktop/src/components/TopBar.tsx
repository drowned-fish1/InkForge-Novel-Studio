import { Download, FilePlus2, FolderOpen, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { useAppTheme } from "@/lib/theme";
import { useProjectStore } from "@/stores/useProjectStore";
import { useProviderStore } from "@/stores/useProviderStore";
import { countCjkAwareWords } from "@/lib/textMetrics";

const saveLabel = {
  idle: "未保存",
  dirty: "有改动",
  saving: "保存中",
  saved: "已保存",
  error: "保存失败"
};

const EDITOR_FONT_SIZE_KEY = "inkforge.editorFontSize";
const DEFAULT_EDITOR_FONT_SIZE = 18;
const MIN_EDITOR_FONT_SIZE = 14;
const MAX_EDITOR_FONT_SIZE = 28;

const readStoredEditorFontSize = () => {
  if (typeof window === "undefined") {
    return DEFAULT_EDITOR_FONT_SIZE;
  }
  const stored = Number.parseInt(window.localStorage.getItem(EDITOR_FONT_SIZE_KEY) ?? "", 10);
  if (!Number.isFinite(stored)) {
    return DEFAULT_EDITOR_FONT_SIZE;
  }
  return Math.min(MAX_EDITOR_FONT_SIZE, Math.max(MIN_EDITOR_FONT_SIZE, stored));
};

export const TopBar = () => {
  const { theme, toggleTheme } = useAppTheme();
  const project = useProjectStore((state) => state.project);
  const current = useProjectStore((state) => state.current);
  const saveState = useProjectStore((state) => state.saveState);
  const focusMode = useProjectStore((state) => state.focusMode);
  const providerStatus = useProviderStore((state) => state.providerStatus);
  const openProject = useProjectStore((state) => state.openProject);
  const closeProject = useProjectStore((state) => state.closeProject);
  const saveCurrentChapter = useProjectStore((state) => state.saveCurrentChapter);
  const exportManuscript = useProjectStore((state) => state.exportManuscript);
  const [editorFontSize, setEditorFontSize] = useState(readStoredEditorFontSize);

  useEffect(() => {
    document.documentElement.style.setProperty("--editor-font-size", `${editorFontSize}px`);
    window.localStorage.setItem(EDITOR_FONT_SIZE_KEY, String(editorFontSize));
  }, [editorFontSize]);

  if (focusMode) {
    return (
      <header className="top-bar focus-top-bar">
        <div className="focus-title">{current?.plan.title ?? "未选择章节"}</div>
        <div className="top-actions">
          <span>{countCjkAwareWords(current?.content ?? "").toLocaleString("zh-CN")} 字</span>
          <span className={`save-pill ${saveState}`}>{saveLabel[saveState]}</span>
        </div>
      </header>
    );
  }

  return (
    <header className="top-bar">
      <div className="brand-block">
        <div className="brand-mark">IF</div>
        <div>
          <div className="brand-title">{project?.meta.title ?? "InkForge"}</div>
          <div className="brand-subtitle">{current?.plan.title ?? "未选择章节"}</div>
        </div>
      </div>

      <div className="top-actions">
        <button
          className="icon-button theme-toggle"
          type="button"
          onClick={toggleTheme}
          title={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
        >
          {theme === "dark" ? "☀" : "🌙"}
        </button>
        <span className={`save-pill ${saveState}`}>{saveLabel[saveState]}</span>
        <span className="model-pill">{providerStatus?.configured ? providerStatus.model : "模型未配置"}</span>
        <div className="font-size-control" aria-label="编辑器字号">
          <button
            className="icon-button text-icon"
            type="button"
            onClick={() => setEditorFontSize((size) => Math.max(MIN_EDITOR_FONT_SIZE, size - 1))}
            title="减小编辑器字号"
          >
            A⁻
          </button>
          <span>{editorFontSize}px</span>
          <button
            className="icon-button text-icon"
            type="button"
            onClick={() => setEditorFontSize((size) => Math.min(MAX_EDITOR_FONT_SIZE, size + 1))}
            title="增大编辑器字号"
          >
            A⁺
          </button>
        </div>
        <button className="icon-button" type="button" onClick={() => void closeProject()} title="新建项目">
          <FilePlus2 size={17} />
        </button>
        <button className="icon-button" type="button" onClick={() => void openProject()} title="打开项目">
          <FolderOpen size={17} />
        </button>
        <button className="icon-button" type="button" onClick={() => void saveCurrentChapter()} title="保存章节">
          <Save size={17} />
        </button>
        <button className="primary-button" type="button" onClick={() => void exportManuscript("markdown")}>
          <Download size={17} />
          导出 MD
        </button>
        <button className="secondary-button compact" type="button" onClick={() => void exportManuscript("txt")}>
          TXT
        </button>
        <button className="secondary-button compact" type="button" onClick={() => void exportManuscript("docx")}>
          DOCX
        </button>
      </div>
    </header>
  );
};
