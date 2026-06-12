import { useState } from "react";
import { Archive, CheckCircle2, Download, FileText, Loader2 } from "lucide-react";
import { useProjectStore } from "@/stores/useProjectStore";

type ExportFormat = "markdown" | "txt" | "docx";

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
  }
];

const formatLabel: Record<ExportFormat, string> = {
  markdown: "Markdown",
  txt: "TXT",
  docx: "DOCX"
};

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "导出失败，请稍后重试。";
};

export const ExportPanel = () => {
  const exportManuscript = useProjectStore((state) => state.exportManuscript);
  const [runningFormat, setRunningFormat] = useState<ExportFormat | null>(null);
  const [status, setStatus] = useState<ExportStatus>({ kind: "idle" });

  const exportFormat = async (format: ExportFormat) => {
    setRunningFormat(format);
    setStatus({ kind: "idle" });
    try {
      const outputPath = await exportManuscript(format);
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
    <section className="module-placeholder">
      <Archive size={32} />
      <h2>导出</h2>
      <p>当前导出模块已支持 Markdown / TXT / DOCX，与顶部导出按钮使用同一套导出能力。</p>

      <div className="overview-grid compact">
        {exportOptions.map((option) => {
          const running = runningFormat === option.format;
          const Icon = running ? Loader2 : FileText;

          return (
            <article className="stat-tile" key={option.format}>
              <strong>{option.label}</strong>
              <small>{option.detail}</small>
              <button
                className={option.primary ? "primary-button full" : "secondary-button full"}
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
