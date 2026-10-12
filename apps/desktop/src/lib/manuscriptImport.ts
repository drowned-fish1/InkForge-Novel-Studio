import { unzipSync } from "fflate";
import { xhtmlToMarkdown } from "./epubImport";

export type ManuscriptEncoding = "auto" | "utf-8" | "gb18030" | "utf-16le" | "utf-16be";
export type ManuscriptSplit = "auto" | "file" | "h1" | "h2";
export interface ManuscriptChapter {
  title: string;
  body: string;
  volumeTitle?: string;
}
export interface ManuscriptSource {
  name: string;
  path: string;
  text: string;
  encoding?: string;
  warnings: string[];
}

export const manuscriptTitle = (name: string): string =>
  name.replace(/\.(?:md|txt|docx|epub)$/iu, "").trim() || "导入文稿";

export const decodeManuscript = (
  bytes: Uint8Array,
  encoding: ManuscriptEncoding = "auto"
): { text: string; encoding: string } => {
  let selected: Exclude<ManuscriptEncoding, "auto">;
  if (encoding !== "auto") selected = encoding;
  else if (bytes[0] === 0xff && bytes[1] === 0xfe) selected = "utf-16le";
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) selected = "utf-16be";
  else {
    try {
      return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" };
    } catch {
      selected = "gb18030";
    }
  }
  return { text: new TextDecoder(selected, { fatal: true }).decode(bytes), encoding: selected };
};

const chapterHeading = /^第[\d零〇一二三四五六七八九十百千万两]+[章节回](?:\s*.*)$/u;
const englishChapter = /^(?:chapter|prologue|epilogue)(?:\s+[\divxlcdm]+)?(?:\s*[:.\-–—]\s*.*|\s+.*)?$/iu;
const volumeHeading = /^第[\d零〇一二三四五六七八九十百千万两]+[卷部](?:\s*.*)$/u;

export const splitManuscript = (
  source: Pick<ManuscriptSource, "text" | "name">,
  split: ManuscriptSplit = "auto"
): ManuscriptChapter[] => {
  const text = source.text.replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n");
  if (split === "file") return text.trim() ? [{ title: manuscriptTitle(source.name), body: text.trim() }] : [];
  // Fenced examples are body text, never chapter boundaries.
  let fence = "";
  const lines = text.split("\n").map((body) => {
    const marker = /^\s*(`{3,}|~{3,})/u.exec(body)?.[1];
    const inside = Boolean(fence);
    if (marker && !fence) fence = marker;
    else if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = "";
    const heading = !inside && !marker ? /^\s*(?:(#{1,6})\s+)?(.+?)\s*$/u.exec(body) : null;
    return {
      body,
      level: heading?.[1]?.length ?? 0,
      title: heading?.[2] ?? "",
      eligible: Boolean(heading) && (heading?.[2]?.length ?? 0) <= 100
    };
  });
  const hasChapters = lines.some(
    (line) => line.eligible && (chapterHeading.test(line.title) || englishChapter.test(line.title))
  );
  const headingLevel =
    split === "h1"
      ? 1
      : split === "h2"
        ? 2
        : Math.min(
            ...lines
              .filter((line) => line.eligible && line.level && !volumeHeading.test(line.title))
              .map((line) => line.level)
          );
  const chapters: ManuscriptChapter[] = [];
  let title = "";
  let volumeTitle: string | undefined;
  let body: string[] = [];
  const flush = () => {
    if (title || body.join("\n").trim())
      chapters.push({
        title: title || manuscriptTitle(source.name),
        body: body.join("\n").trim(),
        ...(volumeTitle ? { volumeTitle } : {})
      });
    title = "";
    body = [];
  };
  for (const line of lines) {
    if (line.eligible && volumeHeading.test(line.title)) {
      flush();
      volumeTitle = line.title;
    } else if (
      line.eligible &&
      (split === "auto" && hasChapters
        ? chapterHeading.test(line.title) || englishChapter.test(line.title)
        : line.level === headingLevel)
    ) {
      flush();
      title = line.title;
    } else body.push(line.body);
  }
  flush();
  return chapters;
};

export const parseDocxManuscript = async (name: string, bytes: Uint8Array): Promise<ManuscriptSource> => {
  if (bytes.byteLength > 64 * 1024 * 1024) throw new Error("Word 文稿超过 64 MB，请拆成多个文件导入。");
  let expandedSize = 0;
  let entries = 0;
  let hasDocument = false;
  let hasImages = false;
  // Read archive metadata with the existing ZIP library before Mammoth opens it.
  unzipSync(bytes, {
    filter: (entry) => {
      expandedSize += entry.originalSize;
      entries += 1;
      if (expandedSize > 256 * 1024 * 1024 || entries > 10_000 || entry.originalSize > 32 * 1024 * 1024)
        throw new Error("Word 文稿解压后过大，请拆分文稿。");
      if (entry.name === "word/document.xml") hasDocument = true;
      if (entry.name.startsWith("word/media/")) hasImages = true;
      return false;
    }
  });
  if (!hasDocument) throw new Error("文件不是有效的 DOCX 文稿；旧版 .doc 请先另存为 .docx。");
  const { default: mammoth } = await import("mammoth");
  const result = await mammoth.convertToHtml(
    { arrayBuffer: Uint8Array.from(bytes).buffer },
    {
      styleMap: [
        "p[style-name='标题 1'] => h1:fresh",
        "p[style-name='标题 2'] => h2:fresh",
        "p[style-name='标题 3'] => h3:fresh"
      ],
      externalFileAccess: false,
      convertImage: mammoth.images.imgElement(async () => ({ src: "", alt: "旧稿插图（未迁移）" }))
    }
  );
  return {
    name,
    path: name,
    text: xhtmlToMarkdown(result.value),
    warnings: [
      ...result.messages.map((message) => message.message),
      ...(hasImages ? ["正文与标题已迁移；图片保留占位文字，排版、批注和修订记录不导入。"] : [])
    ]
  };
};
