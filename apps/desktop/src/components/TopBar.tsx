import { Bot, Check, ChevronDown, Download, FilePlus2, Focus, FolderOpen, Menu, Moon, Save, Sun } from "lucide-react";
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

interface TopBarProps {
  compactLayout?: boolean;
  navigationOpen?: boolean;
  agentOpen?: boolean;
  agentCollapsed?: boolean;
  onToggleNavigation?: () => void;
  onToggleAgent?: () => void;
  onToggleAgentCollapsed?: () => void;
}

export const TopBar = ({
  compactLayout = false,
  navigationOpen = false,
  agentOpen = false,
  agentCollapsed = false,
  onToggleNavigation,
  onToggleAgent,
  onToggleAgentCollapsed
}: TopBarProps) => {
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
  const setFocusMode = useProjectStore((state) => state.setFocusMode);
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
        {compactLayout ? (
          <button
            className="icon-button compact-pane-toggle"
            type="button"
            aria-label={navigationOpen ? "关闭项目导航" : "打开项目导航"}
            aria-pressed={navigationOpen}
            onClick={onToggleNavigation}
          >
            <Menu size={18} />
          </button>
        ) : null}
        <div className="brand-mark">IF</div>
        <div>
          <div className="brand-title">{project?.meta.title ?? "InkForge 小说工坊"}</div>
          <div className="brand-subtitle">{current?.plan.title ?? "未选择章节"}</div>
        </div>
      </div>

      <div className="top-actions">
        {compactLayout ? (
          <button
            className="icon-button compact-pane-toggle"
            type="button"
            aria-label={agentOpen ? "关闭创作 Agent" : "打开创作 Agent"}
            aria-pressed={agentOpen}
            onClick={onToggleAgent}
          >
            <Bot size={18} />
          </button>
        ) : (
          <button
            className={`icon-button agent-collapse-toggle ${agentCollapsed ? "" : "panel-open"}`}
            type="button"
            aria-label={agentCollapsed ? "展开 Agent 面板" : "收起 Agent 面板"}
            aria-pressed={!agentCollapsed}
            title={agentCollapsed ? "展开 Agent 面板" : "收起 Agent 面板"}
            onClick={onToggleAgentCollapsed}
          >
            <Bot size={17} />
          </button>
        )}
        <span className={`top-save-state ${saveState}`} aria-live="polite">
          <Check size={14} />
          {saveLabel[saveState]}
        </span>
        <button
          className="icon-button focus-mode-button"
          type="button"
          aria-label="进入专注写作"
          title="进入专注写作"
          onClick={() => setFocusMode(true)}
        >
          <Focus size={17} />
        </button>
        <button
          className="icon-button theme-toggle"
          type="button"
          aria-label={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
          onClick={toggleTheme}
          title={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
        >
          {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
        </button>
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
        <details className="top-menu">
          <summary className="secondary-button" role="button" aria-label="文件菜单">
            <FolderOpen size={16} />
            文件
            <ChevronDown size={14} />
          </summary>
          <div
            className="top-menu-popover"
            onClick={(event) => event.currentTarget.closest("details")?.removeAttribute("open")}
          >
            <button type="button" onClick={() => void closeProject()}>
              <FilePlus2 size={16} />
              新建项目
            </button>
            <button type="button" onClick={() => void openProject()}>
              <FolderOpen size={16} />
              打开项目
            </button>
            <button type="button" onClick={() => void saveCurrentChapter()}>
              <Save size={16} />
              保存章节
            </button>
          </div>
        </details>
        <details className="top-menu top-export-menu">
          <summary className="primary-button" role="button" aria-label="导出菜单">
            <Download size={16} />
            导出
            <ChevronDown size={14} />
          </summary>
          <div
            className="top-menu-popover align-right"
            onClick={(event) => event.currentTarget.closest("details")?.removeAttribute("open")}
          >
            <button type="button" onClick={() => void exportManuscript("markdown")}>
              Markdown
            </button>
            <button type="button" onClick={() => void exportManuscript("txt")}>
              TXT
            </button>
            <button type="button" onClick={() => void exportManuscript("docx")}>
              DOCX
            </button>
          </div>
        </details>
      </div>
    </header>
  );
};
