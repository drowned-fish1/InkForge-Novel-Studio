import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  BookOpenText,
  CheckCircle2,
  Download,
  FileSearch,
  FileText,
  Image,
  ListTree,
  Loader2,
  Save,
  TriangleAlert
} from "lucide-react";
import { ExportConfigSchema, type ExportConfig, type ExportPreflightIssue } from "@inkforge/schemas";
import { bridge } from "@/lib/browserBridge";
import { useProjectStore } from "@/stores/useProjectStore";

type ExportFormat = "markdown" | "txt" | "docx" | "epub";

type ExportStatus =
  | { kind: "idle" }
  | { kind: "success"; format: ExportFormat; path: string }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

const exportOptions: Array<{
  format: ExportFormat;
  label: string;
  detail: string;
  primary?: boolean;
}> = [
  {
    format: "markdown",
    label: "Markdown",
    detail: "适合继续排版、版本管理或发布到支持 MD 的平台。",
    primary: true
  },
  {
    format: "txt",
    label: "TXT",
    detail: "导出纯文本稿件，便于快速审阅、复制和跨工具交换。"
  },
  {
    format: "docx",
    label: "DOCX",
    detail: "导出 Word 文档（分卷/章节自动分页），便于交付与批注。"
  },
  {
    format: "epub",
    label: "EPUB",
    detail: "标准 EPUB 3 电子书：封面、版权页、分卷目录与阅读器兼容导航。"
  }
];

const formatLabel: Record<ExportFormat, string> = {
  markdown: "Markdown",
  txt: "TXT",
  docx: "DOCX",
  epub: "EPUB"
};

const severityLabel: Record<ExportPreflightIssue["severity"], string> = {
  error: "错误",
  warning: "警告",
  info: "提示"
};

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "导出失败，请稍后重试。";
};

export const ExportPanel = () => {
  const project = useProjectStore((state) => state.project);
  const [runningFormat, setRunningFormat] = useState<ExportFormat | null>(null);
  const [status, setStatus] = useState<ExportStatus>({ kind: "idle" });
  const [config, setConfig] = useState<ExportConfig>(() => ExportConfigSchema.parse({}));
  const [configDirty, setConfigDirty] = useState(false);
  const [issues, setIssues] = useState<ExportPreflightIssue[] | undefined>();
  const [checking, setChecking] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    if (!project) return;
    void bridge
      .loadExportConfig(project.projectPath)
      .then((loaded) => {
        setConfig(loaded);
        setConfigDirty(false);
      })
      .catch(() => undefined);
    setIssues(undefined);
    setStatus({ kind: "idle" });
  }, [project?.projectPath]);

  const updateEpub = (patch: Partial<ExportConfig["epub"]>) => {
    setConfig((state) => ({ ...state, epub: { ...state.epub, ...patch } }));
    setConfigDirty(true);
  };

  const persistConfig = async (): Promise<ExportConfig | undefined> => {
    if (!project) return undefined;
    const saved = await bridge.saveExportConfig(project.projectPath, config);
    setConfig(saved);
    setConfigDirty(false);
    return saved;
  };

  const runPreflight = async () => {
    if (!project) return;
    setChecking(true);
    try {
      await persistConfig();
      setIssues(await bridge.exportPreflight(project.projectPath));
    } catch (error) {
      setStatus({ kind: "error", message: getErrorMessage(error) });
    } finally {
      setChecking(false);
    }
  };

  const exportFormat = async (format: ExportFormat) => {
    if (!project) return;
    setRunningFormat(format);
    setStatus({ kind: "idle" });
    try {
      await persistConfig();
      if (format === "epub") {
        const latest = await bridge.exportPreflight(project.projectPath);
        setIssues(latest);
        if (latest.some((issue) => issue.severity === "error")) {
          setStatus({ kind: "error", message: "导出前检查发现错误，请先处理下方问题再导出 EPUB。" });
          return;
        }
      }
      const outputPath = await bridge.exportManuscript({
        projectPath: project.projectPath,
        format,
        includeChapterTitles: config.includeChapterTitles,
        includeVolumeTitles: config.includeVolumeTitles
      });
      if (!outputPath) {
        setStatus({ kind: "cancelled" });
        return;
      }
      setStatus({ kind: "success", format, path: outputPath });
    } catch (error) {
      setStatus({ kind: "error", message: getErrorMessage(error) });
    } finally {
      setRunningFormat(null);
    }
  };

  const chooseCover = async () => {
    const filePath = await bridge.chooseCoverImage();
    if (filePath) {
      updateEpub({ coverImagePath: filePath });
    } else if (!window.inkforge) {
      setStatus({ kind: "error", message: "浏览器预览无法选择封面文件，请在桌面版设置。" });
    }
  };

  const previewStructure = useMemo(() => {
    if (!project) return [];
    return project.outline.volumes.map((volume) => ({
      title: volume.title,
      chapters: volume.chapters
        .filter((chapter) => !chapter.archived)
        .map((chapter) => ({ title: chapter.title, words: chapter.actualWords }))
    }));
  }, [project?.outline.volumes]);
  const totalWords = useMemo(
    () =>
      previewStructure.reduce(
        (sum, volume) => sum + volume.chapters.reduce((inner, chapter) => inner + chapter.words, 0),
        0
      ),
    [previewStructure]
  );
  const errorCount = issues?.filter((issue) => issue.severity === "error").length ?? 0;

  return (
    <section className="library-screen export-workspace">
      <header className="library-header">
        <div>
          <div className="crumb">交付</div>
          <h2>导出</h2>
          <p>项目级导出配置会保存在项目内；EPUB 导出前会自动运行完整性检查。</p>
        </div>
        <Archive size={28} />
      </header>

      <div className="export-format-list">
        {exportOptions.map((option) => {
          const running = runningFormat === option.format;
          const Icon = running ? Loader2 : FileText;

          return (
            <article className={`export-format-row ${option.format === "epub" ? "featured" : ""}`} key={option.format}>
              <span className="export-format-icon">
                {option.format === "epub" ? <BookOpenText size={19} /> : <FileText size={19} />}
              </span>
              <div>
                <strong>{option.label}</strong>
                <small>{option.detail}</small>
              </div>
              <button
                className={option.primary || option.format === "epub" ? "primary-button" : "secondary-button"}
                type="button"
                disabled={runningFormat !== null}
                onClick={() => void exportFormat(option.format)}
              >
                <Icon size={16} className={running ? "spinning" : undefined} />
                {running ? "导出中..." : `导出 ${option.label}`}
              </button>
            </article>
          );
        })}
      </div>

      <div className="export-toolbar">
        <label>
          <input
            type="checkbox"
            checked={config.includeVolumeTitles}
            onChange={(event) => {
              setConfig((state) => ({ ...state, includeVolumeTitles: event.target.checked }));
              setConfigDirty(true);
            }}
          />
          包含分卷标题
        </label>
        <label>
          <input
            type="checkbox"
            checked={config.includeChapterTitles}
            onChange={(event) => {
              setConfig((state) => ({ ...state, includeChapterTitles: event.target.checked }));
              setConfigDirty(true);
            }}
          />
          包含章节标题
        </label>
        <button
          className="secondary-button compact"
          type="button"
          disabled={checking}
          onClick={() => void runPreflight()}
        >
          {checking ? <Loader2 className="spinning" size={14} /> : <FileSearch size={14} />}
          导出前检查
        </button>
        <button className="secondary-button compact" type="button" onClick={() => setPreviewOpen((value) => !value)}>
          <ListTree size={14} />
          {previewOpen ? "收起预览" : "导出预览"}
        </button>
        {configDirty ? (
          <button className="secondary-button compact" type="button" onClick={() => void persistConfig()}>
            <Save size={14} />
            保存配置
          </button>
        ) : null}
      </div>

      {previewOpen ? (
        <section className="export-preview">
          <header>
            <strong>
              <ListTree size={15} />
              导出预览 · {config.epub.title.trim() || project?.meta.title} ·{" "}
              {config.epub.author.trim() || project?.meta.author}
            </strong>
            <span>
              {previewStructure.length} 卷 · {previewStructure.reduce((sum, item) => sum + item.chapters.length, 0)} 章
              · {totalWords.toLocaleString("zh-CN")} 字
            </span>
          </header>
          <ol>
            {config.epub.coverImagePath ? (
              <li className="export-preview-meta">封面：{config.epub.coverImagePath}</li>
            ) : null}
            {config.epub.copyright.trim() || config.epub.publisher.trim() ? (
              <li className="export-preview-meta">
                版权页：{config.epub.publisher || "—"} · {config.epub.copyright || "—"}
              </li>
            ) : null}
            {previewStructure.map((volume) => (
              <li key={volume.title}>
                {config.includeVolumeTitles ? <strong>{volume.title}</strong> : <em>（不含分卷标题）</em>}
                <ol>
                  {volume.chapters.map((chapter) => (
                    <li key={chapter.title}>
                      {config.includeChapterTitles ? chapter.title : "（无标题章节）"}
                      <small> · {chapter.words.toLocaleString("zh-CN")} 字</small>
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {issues ? (
        <section className="export-preflight-result">
          <header>
            <strong>
              {errorCount ? <TriangleAlert size={15} /> : <CheckCircle2 size={15} />}
              导出前检查 · {issues.length ? `${issues.length} 项（${errorCount} 个错误）` : "全部通过"}
            </strong>
          </header>
          {issues.slice(0, 20).map((issue) => (
            <article key={issue.id} className={`severity-${issue.severity}`}>
              <em>{severityLabel[issue.severity]}</em>
              <div>
                <strong>{issue.title}</strong>
                <small>{issue.detail}</small>
              </div>
            </article>
          ))}
        </section>
      ) : null}

      <section className="epub-config-panel">
        <header>
          <BookOpenText size={17} />
          <div>
            <strong>EPUB 配置（随项目保存）</strong>
            <span>书目信息、封面、版权和排版样式会写入电子书并保存在 .inkforge/export.json。</span>
          </div>
        </header>
        <div className="epub-config-grid">
          <label>
            书名
            <input
              value={config.epub.title}
              placeholder={project?.meta.title}
              onChange={(event) => updateEpub({ title: event.target.value })}
            />
          </label>
          <label>
            作者
            <input
              value={config.epub.author}
              placeholder={project?.meta.author}
              onChange={(event) => updateEpub({ author: event.target.value })}
            />
          </label>
          <label>
            语言
            <select value={config.epub.language} onChange={(event) => updateEpub({ language: event.target.value })}>
              <option value="zh-CN">简体中文</option>
              <option value="zh-TW">繁体中文</option>
              <option value="en">English</option>
              <option value="ja">日本語</option>
            </select>
          </label>
          <label>
            阅读样式
            <select
              value={config.epub.cssTheme}
              onChange={(event) => updateEpub({ cssTheme: event.target.value as "classic" | "modern" })}
            >
              <option value="classic">经典小说（衬线居中标题）</option>
              <option value="modern">现代简洁（无衬线）</option>
            </select>
          </label>
          <label>
            出版方（可选）
            <input value={config.epub.publisher} onChange={(event) => updateEpub({ publisher: event.target.value })} />
          </label>
          <label>
            行距
            <input
              type="number"
              min={1.2}
              max={3}
              step={0.1}
              value={config.epub.lineHeight}
              onChange={(event) => updateEpub({ lineHeight: Number(event.target.value) || 1.9 })}
            />
          </label>
          <div className="epub-cover-row">
            <span>封面（JPG/PNG）</span>
            <code title={config.epub.coverImagePath}>{config.epub.coverImagePath || "未设置"}</code>
            <div className="inline-actions">
              <button className="secondary-button compact" type="button" onClick={() => void chooseCover()}>
                <Image size={14} />
                选择封面
              </button>
              {config.epub.coverImagePath ? (
                <button
                  className="secondary-button compact"
                  type="button"
                  onClick={() => updateEpub({ coverImagePath: "" })}
                >
                  移除
                </button>
              ) : null}
            </div>
          </div>
          <label className="check-inline">
            <input
              type="checkbox"
              checked={config.epub.paragraphIndent}
              onChange={(event) => updateEpub({ paragraphIndent: event.target.checked })}
            />
            段首缩进两格
          </label>
          <label className="check-inline">
            <input
              type="checkbox"
              checked={config.epub.volumeTitlePages}
              onChange={(event) => updateEpub({ volumeTitlePages: event.target.checked })}
            />
            分卷单独成页（分页规则）
          </label>
          <label className="wide">
            简介
            <textarea
              value={config.epub.description}
              placeholder={project?.outline.premise}
              onChange={(event) => updateEpub({ description: event.target.value })}
            />
          </label>
          <label className="wide">
            版权声明（可选）
            <textarea
              value={config.epub.copyright}
              placeholder="例如：© 2026 作者名。保留所有权利。"
              onChange={(event) => updateEpub({ copyright: event.target.value })}
            />
          </label>
        </div>
      </section>

      {status.kind === "success" ? (
        <div className="success-banner compact">
          <CheckCircle2 size={15} />
          已导出 {formatLabel[status.format]}
          {status.format === "epub" ? "（结构与 XHTML 校验通过）" : ""}：{status.path}
        </div>
      ) : null}
      {status.kind === "cancelled" ? <div className="notice-banner">已取消导出。</div> : null}
      {status.kind === "error" ? (
        <div className="error-banner compact">
          <Download size={15} />
          {status.message}
        </div>
      ) : null}
    </section>
  );
};
