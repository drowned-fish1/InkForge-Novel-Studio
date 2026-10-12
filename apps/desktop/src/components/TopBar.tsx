import {
  Bot,
  Check,
  ChevronDown,
  Download,
  FilePlus2,
  Focus,
  FolderOpen,
  LoaderCircle,
  Menu,
  Moon,
  PencilLine,
  Save,
  Sun,
  TriangleAlert,
  X
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAppTheme } from "@/lib/theme";
import { requestActiveEditorSave } from "@/lib/editorActions";
import { useProjectStore } from "@/stores/useProjectStore";
import { useProviderStore } from "@/stores/useProviderStore";
import { countCjkAwareWords } from "@/lib/textMetrics";
import { readChapterPosition } from "@/lib/writingContinuity";

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
  const selectedModule = useProjectStore((state) => state.selectedModule);
  const jumpToChapterOffset = useProjectStore((state) => state.jumpToChapterOffset);
  const providerStatus = useProviderStore((state) => state.providerStatus);
  const configuredProviders = [providerStatus, ...Object.values(providerStatus?.taskProviders ?? {})].filter(
    (value) => value?.configured
  );
  const providerLabel =
    configuredProviders.length > 1
      ? `${configuredProviders.length} 个模型连接`
      : (configuredProviders[0]?.model ?? "模型未配置");
  const openProject = useProjectStore((state) => state.openProject);
  const closeProject = useProjectStore((state) => state.closeProject);
  const saveCurrentChapter = useProjectStore((state) => state.saveCurrentChapter);
  const exportManuscript = useProjectStore((state) => state.exportManuscript);
  const setFocusMode = useProjectStore((state) => state.setFocusMode);
  const [editorFontSize, setEditorFontSize] = useState(readStoredEditorFontSize);
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const closeMenus = (event: PointerEvent | KeyboardEvent) => {
      const menus = headerRef.current?.querySelectorAll<HTMLDetailsElement>(".top-menu[open]");
      menus?.forEach((menu) => {
        if (event instanceof KeyboardEvent ? event.key === "Escape" : !menu.contains(event.target as Node)) {
          menu.open = false;
          if (event instanceof KeyboardEvent) {
            event.preventDefault();
            event.stopPropagation();
            menu.querySelector<HTMLElement>("summary")?.focus();
          }
        }
      });
    };
    document.addEventListener("pointerdown", closeMenus);
    document.addEventListener("keydown", closeMenus, true);
    return () => {
      document.removeEventListener("pointerdown", closeMenus);
      document.removeEventListener("keydown", closeMenus, true);
    };
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty("--editor-font-size", `${editorFontSize}px`);
    window.localStorage.setItem(EDITOR_FONT_SIZE_KEY, String(editorFontSize));
  }, [editorFontSize]);

  if (focusMode) {
    return (
      <header className="top-bar focus-top-bar" ref={headerRef}>
        <div className="focus-title">{current?.plan.title ?? "未选择章节"}</div>
        <div className="top-actions">
          <span>{countCjkAwareWords(current?.content ?? "").toLocaleString("zh-CN")} 字</span>
          <span className={`save-pill ${saveState}`}>{saveLabel[saveState]}</span>
          <button
            className="icon-button"
            type="button"
            aria-label="退出专注写作"
            title="退出专注写作（Esc）"
            onClick={() => setFocusMode(false)}
          >
            <X size={17} />
          </button>
        </div>
      </header>
    );
  }

  return (
    <header className="top-bar" ref={headerRef}>
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
          <div className="brand-title" title={project?.meta.title}>
            {project?.meta.title ?? "InkForge 小说工坊"}
          </div>
          <div className="brand-subtitle" title={current?.plan.title}>
            {current?.plan.title ?? "未选择章节"}
          </div>
        </div>
      </div>

      <div className="top-actions">
        {selectedModule !== "chapters" && current && project ? (
          <button
            className="icon-button"
            type="button"
            aria-label="返回写作"
            title={`继续写《${current.plan.title}》`}
            onClick={() => {
              const position = readChapterPosition(project.projectPath, current.plan.id);
              void jumpToChapterOffset(current.plan, position?.anchor ?? 0, position?.head ?? 0).catch(
                (cause: unknown) =>
                  useProjectStore.setState({ error: cause instanceof Error ? cause.message : "返回写作失败，请重试。" })
              );
            }}
          >
            <PencilLine size={18} />
          </button>
        ) : null}
        {compactLayout ? (
          <button
            className="icon-button compact-pane-toggle"
            type="button"
            aria-label={agentOpen ? "关闭 Agent 面板" : "打开 Agent 面板（支持全书作用域）"}
            aria-pressed={agentOpen}
            onClick={onToggleAgent}
          >
            <Bot size={18} />
          </button>
        ) : (
          <button
            className={`icon-button agent-collapse-toggle ${agentCollapsed ? "" : "panel-open"}`}
            type="button"
            aria-label={agentCollapsed ? "展开 Agent 面板（支持全书作用域）" : "收起 Agent 面板"}
            aria-pressed={!agentCollapsed}
            title={agentCollapsed ? "展开 Agent 面板（支持全书作用域）" : "收起 Agent 面板"}
            onClick={onToggleAgentCollapsed}
          >
            <Bot size={17} />
          </button>
        )}
        <span className={`top-save-state ${saveState}`} aria-live="polite">
          {saveState === "saved" ? (
            <Check size={14} />
          ) : saveState === "saving" ? (
            <LoaderCircle className="spinning" size={14} />
          ) : saveState === "error" ? (
            <TriangleAlert size={14} />
          ) : (
            <Save size={14} />
          )}
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
        <span className="model-pill" title={providerLabel}>
          {providerLabel}
        </span>
        <div className="font-size-control" aria-label="编辑器字号">
          <button
            className="icon-button text-icon"
            type="button"
            disabled={editorFontSize <= MIN_EDITOR_FONT_SIZE}
            aria-label="减小编辑器字号"
            onClick={() => setEditorFontSize((size) => Math.max(MIN_EDITOR_FONT_SIZE, size - 1))}
            title="减小编辑器字号"
          >
            A⁻
          </button>
          <span>{editorFontSize}px</span>
          <button
            className="icon-button text-icon"
            type="button"
            disabled={editorFontSize >= MAX_EDITOR_FONT_SIZE}
            aria-label="增大编辑器字号"
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
            <button
              type="button"
              disabled={!project}
              onClick={() => {
                if (!requestActiveEditorSave()) void saveCurrentChapter();
              }}
            >
              <Save size={16} />
              保存当前页面
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
            <button type="button" onClick={() => void exportManuscript("epub")}>
              EPUB
            </button>
          </div>
        </details>
      </div>
    </header>
  );
};
