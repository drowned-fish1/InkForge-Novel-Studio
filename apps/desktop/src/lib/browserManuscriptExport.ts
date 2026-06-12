import type { ExportInput } from "@/types/app";
import { getProjectRecord } from "@/lib/browserStorage";

type DocxModule = typeof import("docx");
type DocumentInstance = InstanceType<DocxModule["Document"]>;
type ParagraphInstance = InstanceType<DocxModule["Paragraph"]>;
type TextRunInstance = InstanceType<DocxModule["TextRun"]>;

type ExportBlock = {
  kind: "volume" | "chapter";
  title?: string;
  body?: string;
};

const safeFileName = (value: string): string =>
  value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "")
    .replace(/\s+/g, "-") || "manuscript";

const stripLeadingMarkdownTitle = (body: string): string => body.replace(/^\s*#\s+.+?(?:\r?\n)+(?:\r?\n)*/u, "").trim();

const collectExportBlocks = (input: ExportInput): { title: string; blocks: ExportBlock[] } => {
  const record = getProjectRecord(input.projectPath);
  const blocks: ExportBlock[] = [];

  for (const volume of record.summary.outline.volumes) {
    if (input.includeVolumeTitles) {
      blocks.push({ kind: "volume", title: volume.title });
    }
    for (const chapter of volume.chapters.filter((item) => !item.archived)) {
      blocks.push({
        kind: "chapter",
        title: input.includeChapterTitles ? chapter.title : undefined,
        body: stripLeadingMarkdownTitle(record.chapterBodies[chapter.file] ?? "")
      });
    }
  }

  return { title: record.summary.meta.title, blocks };
};

const renderTextExport = (format: "markdown" | "txt", blocks: ExportBlock[]): string =>
  blocks
    .flatMap((block) => {
      if (block.kind === "volume") {
        return block.title ? [format === "markdown" ? `# ${block.title}` : block.title] : [];
      }
      const parts: string[] = [];
      if (block.title) {
        parts.push(format === "markdown" ? `## ${block.title}` : block.title);
      }
      if (block.body) {
        parts.push(block.body);
      }
      return parts;
    })
    .filter(Boolean)
    .join("\n\n");

const markdownInlineRuns = (docx: DocxModule, text: string): TextRunInstance[] => {
  const runs: TextRunInstance[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/gu;
  let index = 0;

  for (const match of text.matchAll(pattern)) {
    if (match.index > index) {
      runs.push(new docx.TextRun({ text: text.slice(index, match.index), size: 24 }));
    }
    const token = match[0];
    if (token.startsWith("`")) {
      runs.push(new docx.TextRun({ text: token.slice(1, -1), size: 22, font: "Consolas" }));
    } else if (token.startsWith("**")) {
      runs.push(new docx.TextRun({ text: token.slice(2, -2), size: 24, bold: true }));
    } else {
      runs.push(new docx.TextRun({ text: token.slice(1, -1), size: 24, italics: true }));
    }
    index = match.index + token.length;
  }

  if (index < text.length) {
    runs.push(new docx.TextRun({ text: text.slice(index), size: 24 }));
  }
  return runs.length ? runs : [new docx.TextRun({ text: "", size: 24 })];
};

const markdownToDocxParagraphs = (docx: DocxModule, markdown: string): ParagraphInstance[] => {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const paragraphs: ParagraphInstance[] = [];
  let buffer: string[] = [];

  const flush = () => {
    const text = buffer.join(" ").trim();
    if (text) {
      paragraphs.push(
        new docx.Paragraph({
          children: markdownInlineRuns(docx, text),
          spacing: { after: 160 },
          indent: { firstLine: 480 }
        })
      );
    }
    buffer = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flush();
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/u.exec(line);
    if (heading) {
      flush();
      paragraphs.push(
        new docx.Paragraph({
          text: heading[2],
          heading: heading[1].length <= 2 ? docx.HeadingLevel.HEADING_3 : docx.HeadingLevel.HEADING_4,
          spacing: { before: 180, after: 120 }
        })
      );
      continue;
    }

    const unordered = /^[-*+]\s+(.+)$/u.exec(line);
    if (unordered) {
      flush();
      paragraphs.push(
        new docx.Paragraph({
          children: markdownInlineRuns(docx, unordered[1]),
          bullet: { level: 0 },
          spacing: { after: 80 }
        })
      );
      continue;
    }

    const ordered = /^\d+[.)]\s+(.+)$/u.exec(line);
    if (ordered) {
      flush();
      paragraphs.push(
        new docx.Paragraph({
          children: markdownInlineRuns(docx, `${line.match(/^\d+/u)?.[0] ?? "1"}. ${ordered[1]}`),
          spacing: { after: 80 },
          indent: { left: 360 }
        })
      );
      continue;
    }

    const quote = /^>\s?(.+)$/u.exec(line);
    if (quote) {
      flush();
      paragraphs.push(
        new docx.Paragraph({
          children: markdownInlineRuns(docx, quote[1]),
          spacing: { after: 120 },
          indent: { left: 360 },
          border: { left: { color: "A8B8B0", size: 8, space: 12, style: "single" } }
        })
      );
      continue;
    }

    buffer.push(line);
  }
  flush();

  return paragraphs;
};

const buildDocx = (docx: DocxModule, title: string, blocks: ExportBlock[]): DocumentInstance => {
  const children: ParagraphInstance[] = [
    new docx.Paragraph({ text: title, heading: docx.HeadingLevel.TITLE, spacing: { after: 360 } })
  ];

  for (const block of blocks) {
    if (block.kind === "volume" && block.title) {
      children.push(
        new docx.Paragraph({
          text: block.title,
          heading: docx.HeadingLevel.HEADING_1,
          spacing: { before: 280, after: 180 }
        })
      );
      continue;
    }
    if (block.kind === "chapter") {
      if (block.title) {
        children.push(
          new docx.Paragraph({
            text: block.title,
            heading: docx.HeadingLevel.HEADING_2,
            spacing: { before: 240, after: 160 }
          })
        );
      }
      children.push(...markdownToDocxParagraphs(docx, block.body ?? ""));
    }
  }

  return new docx.Document({
    creator: "InkForge Local Novel Studio",
    title,
    sections: [
      {
        properties: { page: { margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 } } },
        children
      }
    ]
  });
};

const downloadBlob = (blob: Blob, fileName: string): void => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

export const exportManuscriptInBrowser = async (input: ExportInput): Promise<string> => {
  const { title, blocks } = collectExportBlocks(input);
  const extension = input.format === "markdown" ? "md" : input.format;
  const fileName = `${safeFileName(title)}.${extension}`;

  if (input.format === "docx") {
    const docx = await import("docx");
    const blob = await docx.Packer.toBlob(buildDocx(docx, title, blocks));
    downloadBlob(blob, fileName);
    return fileName;
  }

  const content = `${renderTextExport(input.format, blocks)}\n`;
  downloadBlob(new Blob([content], { type: "text/plain;charset=utf-8" }), fileName);
  return fileName;
};
