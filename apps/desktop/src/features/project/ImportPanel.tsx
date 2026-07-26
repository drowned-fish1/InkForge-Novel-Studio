import { ChangeEvent, DragEvent, useMemo, useRef, useState } from "react";
import { FileText, FolderInput, Upload } from "lucide-react";
import { useProjectStore, type ImportedChapterDraft } from "@/stores/useProjectStore";

type ImportFile = {
  name: string;
  path: string;
  text: string;
};

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

const chapterHeadingPattern = /^\s*(?:#\s+(.+)|((?:第[\d零一二三四五六七八九十百千万两]+[章节回])[^\r\n]*))\s*$/u;

const fileTitle = (fileName: string): string => fileName.replace(/\.(md|txt)$/iu, "").trim() || "导入文稿";

const readTextFile = (file: File): Promise<ImportFile> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve({
        name: file.name,
        path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
        text: String(reader.result ?? "")
      });
    reader.onerror = () => reject(reader.error ?? new Error("读取文件失败"));
    reader.readAsText(file, "utf-8");
  });

const isTextManuscript = (file: File): boolean => /\.(md|txt)$/iu.test(file.name);

const parseFileChapters = (file: ImportFile): ImportedChapterDraft[] => {
  const lines = file.text.replace(/\r\n/g, "\n").split("\n");
  const chapters: ImportedChapterDraft[] = [];
  let currentTitle = "";
  let currentLines: string[] = [];
  let foundHeading = false;

  const pushCurrent = () => {
    const body = currentLines.join("\n").trim();
    if (currentTitle || body) {
      chapters.push({
        title: currentTitle || fileTitle(file.name),
        body
      });
    }
    currentLines = [];
  };

  for (const line of lines) {
    const match = chapterHeadingPattern.exec(line);
    if (match) {
      if (foundHeading || currentLines.join("\n").trim()) {
        pushCurrent();
      }
      foundHeading = true;
      currentTitle = (match[1] || match[2] || "").trim();
      continue;
    }
    currentLines.push(line);
  }

  if (foundHeading) {
    pushCurrent();
    return chapters.filter((chapter) => chapter.title || chapter.body);
  }

  const body = file.text.trim();
  return body ? [{ title: fileTitle(file.name), body }] : [];
};

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

const normalizeFiles = async (files: File[]): Promise<ImportFile[]> => {
  const manuscripts = files.filter(isTextManuscript);
  const imported = await Promise.all(manuscripts.map(readTextFile));
  return imported.sort((a, b) => a.path.localeCompare(b.path, "zh-CN", { numeric: true }));
};

export const ImportPanel = () => {
  const createImportedProject = useProjectStore((state) => state.createImportedProject);
  const [chapters, setChapters] = useState<ImportedChapterDraft[]>([]);
  const [projectTitle, setProjectTitle] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const totalWords = useMemo(() => chapters.reduce((count, chapter) => count + chapter.body.length, 0), [chapters]);

  const loadFiles = async (files: File[]) => {
    setError("");
    const imported = await normalizeFiles(files);
    const nextChapters = imported.flatMap(parseFileChapters);
    if (!nextChapters.length) {
      setChapters([]);
      setError("没有识别到可导入的 .md 或 .txt 文稿。");
      return;
    }
    setChapters(nextChapters);
    setProjectTitle((current) => current || fileTitle(imported[0].name));
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

    setBusy(true);
    setError("");
    try {
      await createImportedProject(
        {
          title,
          author: "local-user",
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
      {!chapters.length ? <p className="import-helper">支持 .md 和 .txt，可自动按章节标题拆分。</p> : null}

      <input
        ref={inputRef}
        className="hidden-file-input"
        type="file"
        accept=".md,.txt,text/markdown,text/plain"
        multiple
        onChange={onPickFiles}
      />

      <div className="import-actions">
        <button className="secondary-button" type="button" onClick={() => inputRef.current?.click()}>
          <Upload size={16} />
          选择 .md / .txt
        </button>
        <span>
          <FolderInput size={15} /> 或拖入文件/文件夹
        </span>
      </div>

      {chapters.length ? (
        <>
          <label className="import-title-field">
            项目名
            <input value={projectTitle} onChange={(event) => setProjectTitle(event.target.value)} />
          </label>
          <div className="import-preview-list">
            {chapters.map((chapter, index) => (
              <article key={`${chapter.title}-${index}`}>
                <strong>
                  {index + 1}. {chapter.title}
                </strong>
                <p>{chapter.body.replace(/\s+/g, " ").slice(0, 100) || "空章节"}</p>
              </article>
            ))}
          </div>
          <button className="primary-button full" type="button" disabled={busy} onClick={() => void confirmImport()}>
            确认创建项目
          </button>
        </>
      ) : null}

      {error ? <div className="error-banner compact">{error}</div> : null}
    </section>
  );
};
