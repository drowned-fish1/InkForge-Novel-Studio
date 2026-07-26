import { useState } from "react";
import { Archive, BookOpenText, CheckCircle2, Download, FileText, Loader2 } from "lucide-react";
import { useProjectStore } from "@/stores/useProjectStore";

type ExportFormat = "markdown" | "txt" | "docx" | "epub";

type ExportStatus =
  | { kind: "idle" }
  | { kind: "success"; format: ExportFormat; path: string }
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
    detail: "导出 Word 文档，便于交付、批注和后续格式整理。"
  },
  {
    format: "epub",
    label: "EPUB",
    detail: "生成带目录、章节导航与阅读样式的标准电子书。"
  }
];

const formatLabel: Record<ExportFormat, string> = {
  markdown: "Markdown",
  txt: "TXT",
  docx: "DOCX",
  epub: "EPUB"
};

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "导出失败，请稍后重试。";
};

export const ExportPanel = () => {
  const project = useProjectStore((state) => state.project);
  const exportManuscript = useProjectStore((state) => state.exportManuscript);
  const [runningFormat, setRunningFormat] = useState<ExportFormat | null>(null);
  const [status, setStatus] = useState<ExportStatus>({ kind: "idle" });
  const [epub, setEpub] = useState({
    title: project?.meta.title ?? "",
    author: project?.meta.author ?? "",
    language: "zh-CN",
    description: project?.outline.premise ?? "",
    cssTheme: "classic" as "classic" | "modern"
  });

  const exportFormat = async (format: ExportFormat) => {
    setRunningFormat(format);
    setStatus({ kind: "idle" });
    try {
      const outputPath = await exportManuscript(format, format === "epub" ? epub : undefined);
      if (!outputPath) {
        setStatus({ kind: "error", message: "当前没有打开项目，无法导出稿件。" });
        return;
      }
      setStatus({ kind: "success", format, path: outputPath });
    } catch (error) {
      setStatus({ kind: "error", message: getErrorMessage(error) });
    } finally {
      setRunningFormat(null);
    }
  };

  return (
    <section className="library-screen export-workspace">
      <header className="library-header">
        <div>
          <div className="crumb">交付</div>
          <h2>导出</h2>
          <p>从同一份项目正文生成可继续编辑的稿件或可直接阅读的电子书。</p>
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
                <Icon size={16} />
                {running ? "导出中..." : `导出 ${option.label}`}
              </button>
            </article>
          );
        })}
      </div>

      <section className="epub-config-panel">
        <header>
          <BookOpenText size={17} />
          <div>
            <strong>EPUB 元数据与样式</strong>
            <span>这些信息会写入电子书书目信息，并影响阅读器中的展示。</span>
          </div>
        </header>
        <div className="epub-config-grid">
          <label>
            书名
            <input value={epub.title} onChange={(event) => setEpub({ ...epub, title: event.target.value })} />
          </label>
          <label>
            作者
            <input value={epub.author} onChange={(event) => setEpub({ ...epub, author: event.target.value })} />
          </label>
          <label>
            语言
            <select value={epub.language} onChange={(event) => setEpub({ ...epub, language: event.target.value })}>
              <option value="zh-CN">简体中文</option>
              <option value="zh-TW">繁体中文</option>
              <option value="en">English</option>
              <option value="ja">日本語</option>
            </select>
          </label>
          <label>
            阅读样式
            <select
              value={epub.cssTheme}
              onChange={(event) => setEpub({ ...epub, cssTheme: event.target.value as "classic" | "modern" })}
            >
              <option value="classic">经典小说</option>
              <option value="modern">现代简洁</option>
            </select>
          </label>
          <label className="wide">
            简介
            <textarea
              value={epub.description}
              onChange={(event) => setEpub({ ...epub, description: event.target.value })}
            />
          </label>
        </div>
      </section>

      {status.kind === "success" ? (
        <div className="success-banner compact">
          <CheckCircle2 size={15} />
          已导出 {formatLabel[status.format]}：{status.path}
        </div>
      ) : null}
      {status.kind === "error" ? (
        <div className="error-banner compact">
          <Download size={15} />
          {status.message}
        </div>
      ) : null}
    </section>
  );
};
