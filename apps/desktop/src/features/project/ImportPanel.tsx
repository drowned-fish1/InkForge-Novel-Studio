import { ChangeEvent, DragEvent, useMemo, useRef, useState } from "react";
import { FileText, FolderInput, Upload } from "lucide-react";
import { parseEpub } from "@/lib/epubImport";
import {
  decodeManuscript,
  manuscriptTitle,
  parseDocxManuscript,
  splitManuscript,
  type ManuscriptEncoding,
  type ManuscriptSplit
} from "@/lib/manuscriptImport";
import { useProjectStore, type ImportedChapterDraft } from "@/stores/useProjectStore";

type TextImportFile = {
  kind: "text";
  name: string;
  path: string;
  text: string;
  warnings: string[];
  encoding?: string;
};

type EpubImportFile = {
  kind: "epub";
  name: string;
  path: string;
  bytes: Uint8Array;
};

type ImportFile = TextImportFile | EpubImportFile;

interface FileSystemEntryLike {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
}

interface FileSystemFileEntryLike extends FileSystemEntryLike {
  file: (success: (file: File) => void, error?: (error: DOMException) => void) => void;
}

interface FileSystemDirectoryEntryLike extends FileSystemEntryLike {
  createReader: () => {
    readEntries: (success: (entries: FileSystemEntryLike[]) => void, error?: (error: DOMException) => void) => void;
  };
}

type DataTransferItemWithEntry = Omit<DataTransferItem, "webkitGetAsEntry"> & {
  webkitGetAsEntry?: () => FileSystemEntryLike | null;
};

const readTextFile = async (file: File, encoding: ManuscriptEncoding): Promise<TextImportFile> => {
  if (file.size > 64 * 1024 * 1024) throw new Error(`${file.name} 超过 64 MB，请拆分文稿。`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const source = /\.docx$/iu.test(file.name)
    ? await parseDocxManuscript(file.name, bytes)
    : { ...decodeManuscript(bytes, encoding), warnings: [] };
  return { ...source, kind: "text", name: file.name, path: file.webkitRelativePath || file.name };
};

const readEpubFile = async (file: File): Promise<EpubImportFile> => ({
  kind: "epub",
  name: file.name,
  path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
  bytes: new Uint8Array(await file.arrayBuffer())
});

const isSupportedManuscript = (file: File): boolean => /\.(md|txt|docx|epub)$/iu.test(file.name);

const entryToFiles = async (entry: FileSystemEntryLike): Promise<File[]> => {
  if (entry.isFile) {
    return new Promise((resolve, reject) => {
      (entry as FileSystemFileEntryLike).file((file) => resolve([file]), reject);
    });
  }

  if (!entry.isDirectory) {
    return [];
  }

  const directory = entry as FileSystemDirectoryEntryLike;
  const reader = directory.createReader();
  const entries: FileSystemEntryLike[] = [];

  for (;;) {
    const batch = await new Promise<FileSystemEntryLike[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (!batch.length) {
      break;
    }
    entries.push(...batch);
  }

  const nested = await Promise.all(entries.map(entryToFiles));
  return nested.flat();
};

const filesFromDrop = async (event: DragEvent<HTMLElement>): Promise<File[]> => {
  const entries = Array.from(event.dataTransfer.items)
    .map((item) => (item as DataTransferItemWithEntry).webkitGetAsEntry?.())
    .filter((entry): entry is FileSystemEntryLike => Boolean(entry));

  if (!entries.length) {
    return Array.from(event.dataTransfer.files);
  }

  const files = await Promise.all(entries.map(entryToFiles));
  return files.flat();
};

const normalizeFiles = async (files: File[], encoding: ManuscriptEncoding): Promise<ImportFile[]> => {
  const manuscripts = files.filter(isSupportedManuscript);
  const imported: ImportFile[] = [];
  // Large Word files should not all decompress simultaneously.
  for (const file of manuscripts)
    imported.push(await (/\.epub$/iu.test(file.name) ? readEpubFile(file) : readTextFile(file, encoding)));
  return imported.sort((a, b) => a.path.localeCompare(b.path, "zh-CN", { numeric: true }));
};

export const ImportPanel = () => {
  const createImportedProject = useProjectStore((state) => state.createImportedProject);
  const [chapters, setChapters] = useState<ImportedChapterDraft[]>([]);
  const [projectTitle, setProjectTitle] = useState("");
  const [author, setAuthor] = useState("local-user");
  const [sourceSummary, setSourceSummary] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [sourceFiles, setSourceFiles] = useState<File[]>([]);
  const [encoding, setEncoding] = useState<ManuscriptEncoding>("auto");
  const [split, setSplit] = useState<ManuscriptSplit>("auto");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const totalWords = useMemo(() => chapters.reduce((count, chapter) => count + chapter.body.length, 0), [chapters]);

  const loadFiles = async (files: File[]) => {
    setError("");
    setWarnings([]);
    setBusy(true);
    setSourceFiles(files);
    try {
      const imported = await normalizeFiles(files, encoding);
      const nextChapters: ImportedChapterDraft[] = [];
      const importWarnings: string[] = [];
      let suggestedTitle = imported[0] ? manuscriptTitle(imported[0].name) : "";
      let suggestedAuthor = "local-user";
      let epubCount = 0;

      for (const file of imported) {
        if (file.kind === "text") {
          nextChapters.push(...splitManuscript(file, split));
          importWarnings.push(...file.warnings.map((warning) => `${file.name}：${warning}`));
          if (file.encoding)
            importWarnings.push(`${file.name}：使用 ${file.encoding.toUpperCase()} 解码；若乱码请切换编码后重新解析。`);
          continue;
        }
        const epub = parseEpub(file.bytes);
        epubCount += 1;
        nextChapters.push(...epub.chapters.map(({ title, body }) => ({ title, body })));
        if (epubCount === 1) {
          suggestedTitle = epub.title || suggestedTitle;
          suggestedAuthor = epub.author || suggestedAuthor;
        }
        importWarnings.push(...epub.warnings.map((warning) => `${file.name}：${warning}`));
      }

      if (!nextChapters.length) {
        setChapters([]);
        setSourceSummary("");
        setError("没有识别到可导入的 .docx、.epub、.md 或 .txt 文稿。旧版 .doc 请另存为 .docx。");
        return;
      }
      setChapters(nextChapters);
      setSelectedIndex(0);
      setProjectTitle(suggestedTitle);
      setAuthor(suggestedAuthor);
      setWarnings(importWarnings);
      setSourceSummary(
        epubCount
          ? `已解析 ${epubCount} 本 EPUB，共 ${nextChapters.length} 个正文章节`
          : `已读取 ${imported.length} 个文稿文件，共 ${nextChapters.length} 个章节`
      );
    } catch (caught) {
      setChapters([]);
      setSourceSummary("");
      setError(caught instanceof Error ? caught.message : "文稿解析失败。");
    } finally {
      setBusy(false);
    }
  };

  const onPickFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length) {
      void loadFiles(files);
    }
    event.target.value = "";
  };

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragActive(false);
    void filesFromDrop(event)
      .then(loadFiles)
      .catch(() => setError("拖入的文件读取失败。"));
  };

  const confirmImport = async () => {
    const title = projectTitle.trim();
    if (!title) {
      setError("请填写项目名。");
      return;
    }
    if (!chapters.length) {
      setError("请先选择文稿。");
      return;
    }
    if (chapters.some((chapter) => !chapter.title.trim())) {
      setError("每个章节都需要标题，请在预览中补全。");
      return;
    }

    setBusy(true);
    setError("");
    try {
      await createImportedProject(
        {
          title,
          author: author.trim() || "local-user",
          genre: [],
          targetWords: Math.max(100000, totalWords),
          style: "节奏快，冲突强，少解释，多行动",
          protagonist: "",
          premise: chapters[0]?.body.slice(0, 160) ?? ""
        },
        chapters
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "导入失败。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className={`import-panel ${dragActive ? "drag-active" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={onDrop}
    >
      <div className="import-panel-header">
        <FileText size={18} />
        <strong>用已有文稿创建小说</strong>
        {chapters.length ? (
          <span>
            {chapters.length} 章 / {totalWords.toLocaleString("zh-CN")} 字符
          </span>
        ) : null}
      </div>
      {!chapters.length ? (
        <p className="import-helper">
          支持 Word .docx、EPUB 2/3、Markdown 和 TXT；自动识别中文分卷与章节、英文 Chapter 和文档标题。旧版 .doc
          请先另存为 .docx。
        </p>
      ) : null}

      <input
        ref={inputRef}
        className="hidden-file-input"
        type="file"
        accept=".docx,.epub,.md,.txt,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/epub+zip,text/markdown,text/plain"
        multiple
        onChange={onPickFiles}
      />

      <div className="import-actions">
        <button className="secondary-button" type="button" disabled={busy} onClick={() => inputRef.current?.click()}>
          <Upload size={16} />
          {busy ? "正在解析…" : "选择 Word / EPUB / 文稿"}
        </button>
        <span>
          <FolderInput size={15} /> 或拖入文件/文件夹
        </span>
      </div>

      <div className="import-migration-options">
        <label>
          TXT / Markdown 编码
          <select
            value={encoding}
            disabled={busy}
            onChange={(event) => setEncoding(event.target.value as ManuscriptEncoding)}
          >
            <option value="auto">自动（UTF-8 / BOM / GB18030）</option>
            <option value="utf-8">UTF-8</option>
            <option value="gb18030">GBK / GB18030</option>
            <option value="utf-16le">UTF-16 LE</option>
            <option value="utf-16be">UTF-16 BE</option>
          </select>
        </label>
        <label>
          拆章规则
          <select value={split} disabled={busy} onChange={(event) => setSplit(event.target.value as ManuscriptSplit)}>
            <option value="auto">自动识别卷、章与标题</option>
            <option value="file">每个文件一章</option>
            <option value="h1">按一级标题</option>
            <option value="h2">按二级标题</option>
          </select>
        </label>
        {sourceFiles.length ? (
          <button
            className="secondary-button compact"
            type="button"
            disabled={busy}
            onClick={() => void loadFiles(sourceFiles)}
          >
            重新解析 / 重置预览
          </button>
        ) : null}
      </div>

      {chapters.length ? (
        <>
          {sourceSummary ? <div className="import-source-summary">{sourceSummary}</div> : null}
          <div className="import-metadata-fields">
            <label className="import-title-field">
              项目名
              <input disabled={busy} value={projectTitle} onChange={(event) => setProjectTitle(event.target.value)} />
            </label>
            <label className="import-title-field">
              作者
              <input disabled={busy} value={author} onChange={(event) => setAuthor(event.target.value)} />
            </label>
          </div>
          <div className="import-preview-list">
            {chapters.map((chapter, index) => (
              <article key={index} className={selectedIndex === index ? "import-chapter-selected" : ""}>
                <button
                  type="button"
                  className="import-preview-select"
                  disabled={busy}
                  aria-pressed={selectedIndex === index}
                  onClick={() => setSelectedIndex(index)}
                >
                  <strong>
                    {index + 1}. {chapter.title}
                  </strong>
                  {chapter.volumeTitle ? <small>{chapter.volumeTitle}</small> : null}
                  <p>{chapter.body.replace(/\s+/g, " ").slice(0, 100) || "空章节"}</p>
                </button>
              </article>
            ))}
          </div>
          {chapters[selectedIndex] ? (
            <div className="import-chapter-editor">
              <label>
                章节标题
                <input
                  disabled={busy}
                  value={chapters[selectedIndex].title}
                  onChange={(event) =>
                    setChapters((items) =>
                      items.map((item, index) =>
                        index === selectedIndex ? { ...item, title: event.target.value } : item
                      )
                    )
                  }
                />
              </label>
              <label>
                所属卷（留空为第一卷）
                <input
                  disabled={busy}
                  value={chapters[selectedIndex].volumeTitle ?? ""}
                  onChange={(event) =>
                    setChapters((items) =>
                      items.map((item, index) =>
                        index === selectedIndex ? { ...item, volumeTitle: event.target.value } : item
                      )
                    )
                  }
                />
              </label>
              <label className="wide">
                正文预览与校正
                <textarea
                  ref={bodyRef}
                  disabled={busy}
                  value={chapters[selectedIndex].body}
                  onChange={(event) =>
                    setChapters((items) =>
                      items.map((item, index) =>
                        index === selectedIndex ? { ...item, body: event.target.value } : item
                      )
                    )
                  }
                />
              </label>
              <div className="import-chapter-actions">
                <button
                  className="secondary-button compact"
                  type="button"
                  disabled={busy}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    const position = bodyRef.current?.selectionStart ?? 0;
                    const chapter = chapters[selectedIndex];
                    if (!position || position >= chapter.body.length) {
                      setError("请先在正文预览中把光标放到需要拆章的位置。");
                      return;
                    }
                    setError("");
                    setChapters((items) =>
                      items.flatMap((item, index) =>
                        index === selectedIndex
                          ? [
                              { ...item, body: item.body.slice(0, position).trimEnd() },
                              { ...item, title: `${item.title}（续）`, body: item.body.slice(position).trimStart() }
                            ]
                          : [item]
                      )
                    );
                    setSelectedIndex(selectedIndex + 1);
                  }}
                >
                  在光标处拆章
                </button>
                {([-1, 1] as const).map((direction) => (
                  <button
                    key={direction}
                    className="secondary-button compact"
                    type="button"
                    disabled={busy || selectedIndex + direction < 0 || selectedIndex + direction >= chapters.length}
                    onClick={() => {
                      const target = selectedIndex + direction;
                      setChapters((items) => {
                        const next = [...items];
                        [next[selectedIndex], next[target]] = [next[target], next[selectedIndex]];
                        return next;
                      });
                      setSelectedIndex(target);
                    }}
                  >
                    {direction < 0 ? "上移" : "下移"}
                  </button>
                ))}
                <button
                  className="secondary-button compact"
                  type="button"
                  disabled={busy || selectedIndex >= chapters.length - 1}
                  onClick={() =>
                    setChapters((items) =>
                      items.flatMap((item, index) =>
                        index === selectedIndex
                          ? [
                              {
                                ...item,
                                body: `${item.body}\n\n## ${items[index + 1].title}\n\n${items[index + 1].body}`
                              }
                            ]
                          : index === selectedIndex + 1
                            ? []
                            : [item]
                      )
                    )
                  }
                >
                  合并下一章
                </button>
                <button
                  className="tiny-text-button danger-text"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setChapters((items) => items.filter((_, index) => index !== selectedIndex));
                    setSelectedIndex(Math.max(0, selectedIndex - 1));
                  }}
                >
                  移除本章
                </button>
              </div>
              <p className="import-helper">
                调整只影响待导入预览；“重新解析”可恢复源文件内容。EPUB 始终保留原阅读顺序与拆章规则。
              </p>
            </div>
          ) : null}
          <button className="primary-button full" type="button" disabled={busy} onClick={() => void confirmImport()}>
            确认创建项目
          </button>
        </>
      ) : null}

      {warnings.length ? (
        <div className="import-warning" role="status">
          {warnings.slice(0, 3).map((warning) => (
            <span key={warning}>{warning}</span>
          ))}
          {warnings.length > 3 ? <span>另有 {warnings.length - 3} 条提示</span> : null}
        </div>
      ) : null}
      {error ? <div className="error-banner compact">{error}</div> : null}
    </section>
  );
};
