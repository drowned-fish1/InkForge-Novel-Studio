import type { ExportInput } from "@/types/app";
import { EpubExportConfigSchema } from "@inkforge/schemas";
import { strToU8, zipSync, type Zippable } from "fflate";
import { marked, Renderer } from "marked";
import { getProjectRecord } from "./browserStorage";

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

const escapeXml = (value: string): string =>
  value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&apos;");

const browserEpubMarkdownRenderer = (): Renderer => {
  const renderer = new Renderer();
  renderer.html = ({ text }) => escapeXml(text);
  renderer.hr = () => "<hr />\n";
  renderer.br = () => "<br />\n";
  renderer.checkbox = ({ checked }) => (checked ? "☒ " : "☐ ");
  renderer.image = ({ text }) => `<span class="image-alt">${escapeXml(text)}</span>`;
  renderer.link = function ({ href, title, tokens }) {
    const label = this.parser.parseInline(tokens);
    const normalizedHref = href.trim();
    if (!/^(?:https?:|mailto:|#)/iu.test(normalizedHref)) return label;
    const titleAttribute = title ? ` title="${escapeXml(title)}"` : "";
    return `<a href="${escapeXml(normalizedHref)}"${titleAttribute}>${label}</a>`;
  };
  return renderer;
};

export const renderBrowserEpubMarkdown = (markdown: string): string =>
  String(marked.parse(markdown, { async: false, renderer: browserEpubMarkdownRenderer() })).replace(
    /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);)/giu,
    "&amp;"
  );

const epubXhtml = (language: string, title: string, body: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="${escapeXml(language)}">
<head><title>${escapeXml(title)}</title><link rel="stylesheet" href="../styles/book.css"/></head>
<body>${body}</body></html>`;

export const buildBrowserEpub = (input: ExportInput, fallbackTitle: string): Uint8Array => {
  const record = getProjectRecord(input.projectPath);
  const metadata = EpubExportConfigSchema.parse({
    title: fallbackTitle,
    author: record.summary.meta.author,
    ...input.epub
  });
  const language = metadata.language.trim() || "zh-CN";
  const title = metadata.title.trim() || fallbackTitle;
  const author = metadata.author.trim() || record.summary.meta.author;
  const identifier = record.summary.meta.projectId || `inkforge-${safeFileName(title)}`;
  const modified = record.summary.meta.updatedAt.replace(/\.\d{3}Z$/u, "Z");
  type Section = {
    id: string;
    file: string;
    label: string;
    content: string;
    inToc: boolean;
    children?: Array<{ file: string; label: string }>;
  };
  const sections: Section[] = [];

  if (metadata.publisher.trim() || metadata.copyright.trim()) {
    const body = [
      `<h2>${escapeXml(title)}</h2>`,
      author ? `<p>作者：${escapeXml(author)}</p>` : "",
      metadata.publisher.trim() ? `<p>出版：${escapeXml(metadata.publisher.trim())}</p>` : "",
      metadata.copyright.trim() ? `<p>${escapeXml(metadata.copyright.trim())}</p>` : ""
    ]
      .filter(Boolean)
      .join("\n");
    sections.push({
      id: "copyright-page",
      file: "copyright.xhtml",
      label: "版权信息",
      inToc: true,
      content: epubXhtml(language, "版权信息", `<section class="copyright-page">${body}</section>`)
    });
  }

  const activeVolumes = record.summary.outline.volumes
    .map((volume) => ({ ...volume, chapters: volume.chapters.filter((chapter) => !chapter.archived) }))
    .filter((volume) => volume.chapters.length > 0);
  activeVolumes.forEach((volume, volumeIndex) => {
    const volumeLabel = volume.title.trim() || `第 ${volumeIndex + 1} 卷`;
    const childLinks: Array<{ file: string; label: string }> = [];
    let volumeSection: Section | undefined;
    if (metadata.volumeTitlePages && activeVolumes.length > 1) {
      volumeSection = {
        id: `volume-${volumeIndex + 1}`,
        file: `volume-${volumeIndex + 1}.xhtml`,
        label: volumeLabel,
        inToc: true,
        children: childLinks,
        content: epubXhtml(
          language,
          volumeLabel,
          `<section class="volume-title"><h1>${escapeXml(volumeLabel)}</h1></section>`
        )
      };
      sections.push(volumeSection);
    }
    volume.chapters.forEach((chapter, chapterIndex) => {
      const fallbackLabel = `第 ${chapterIndex + 1} 章`;
      const label = input.includeChapterTitles ? chapter.title.trim() || fallbackLabel : fallbackLabel;
      const file = `v${volumeIndex + 1}-c${chapterIndex + 1}.xhtml`;
      const body = stripLeadingMarkdownTitle(record.chapterBodies[chapter.file] ?? "");
      const heading = input.includeChapterTitles ? `<h2>${escapeXml(label)}</h2>` : "";
      sections.push({
        id: `v${volumeIndex + 1}-c${chapterIndex + 1}`,
        file,
        label,
        inToc: !volumeSection,
        content: epubXhtml(language, label, `${heading}${renderBrowserEpubMarkdown(body)}`)
      });
      childLinks.push({ file, label });
    });
  });

  let playOrder = 0;
  const ncxPoint = (file: string, label: string, children = ""): string => {
    playOrder += 1;
    return `<navPoint id="np-${playOrder}" playOrder="${playOrder}"><navLabel><text>${escapeXml(label)}</text></navLabel><content src="text/${file}"/>${children}</navPoint>`;
  };
  const tocSections = sections.filter((section) => section.inToc);
  const tocItems = tocSections
    .map((section) => {
      const children = section.children?.length
        ? `<ol>${section.children.map((child) => `<li><a href="text/${child.file}">${escapeXml(child.label)}</a></li>`).join("")}</ol>`
        : "";
      return `<li><a href="text/${section.file}">${escapeXml(section.label)}</a>${children}</li>`;
    })
    .join("");
  const ncxItems = tocSections
    .map((section) =>
      ncxPoint(
        section.file,
        section.label,
        (section.children ?? []).map((child) => ncxPoint(child.file, child.label)).join("")
      )
    )
    .join("");
  const fontFamily = metadata.cssTheme === "modern" ? "system-ui,sans-serif" : "serif";
  const headingAlign = metadata.cssTheme === "modern" ? "" : "text-align:center;";
  const indent = metadata.paragraphIndent ? "text-indent:2em;" : "";
  const archive: Zippable = {
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'
    ),
    "OEBPS/styles/book.css": strToU8(
      `body{font-family:${fontFamily};line-height:${metadata.lineHeight};margin:6%}h1,h2{${headingAlign}line-height:1.3}p{${indent}margin:.55em 0}.volume-title{display:flex;align-items:center;justify-content:center;min-height:70vh;text-align:center}.copyright-page{margin-top:35vh;text-align:center;color:#555}.image-alt{color:#666;font-style:italic}`
    ),
    "OEBPS/nav.xhtml": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${escapeXml(language)}"><head><title>目录</title><link rel="stylesheet" href="styles/book.css"/></head><body><nav epub:type="toc"><h1>目录</h1><ol>${tocItems}</ol></nav><nav epub:type="landmarks" hidden=""><ol><li><a epub:type="bodymatter" href="text/${sections.find((section) => section.id !== "copyright-page")?.file ?? sections[0]?.file ?? ""}">正文</a></li></ol></nav></body></html>`
    ),
    "OEBPS/toc.ncx": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="${escapeXml(identifier)}"/><meta name="dtb:depth" content="2"/></head><docTitle><text>${escapeXml(title)}</text></docTitle><navMap>${ncxItems}</navMap></ncx>`
    ),
    "OEBPS/content.opf": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${escapeXml(language)}"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">${escapeXml(identifier)}</dc:identifier><dc:title>${escapeXml(title)}</dc:title><dc:creator>${escapeXml(author)}</dc:creator><dc:language>${escapeXml(language)}</dc:language><dc:description>${escapeXml(metadata.description)}</dc:description>${metadata.publisher.trim() ? `<dc:publisher>${escapeXml(metadata.publisher.trim())}</dc:publisher>` : ""}${metadata.copyright.trim() ? `<dc:rights>${escapeXml(metadata.copyright.trim())}</dc:rights>` : ""}<meta property="dcterms:modified">${modified}</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="css" href="styles/book.css" media-type="text/css"/>${sections.map((item) => `<item id="${item.id}" href="text/${item.file}" media-type="application/xhtml+xml"/>`).join("")}</manifest><spine toc="ncx">${sections.map((item) => `<itemref idref="${item.id}"/>`).join("")}</spine></package>`
    )
  };
  sections.forEach((section) => {
    archive[`OEBPS/text/${section.file}`] = strToU8(section.content);
  });
  return zipSync(archive, { level: 6 });
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

  if (input.format === "epub") {
    const bytes = buildBrowserEpub(input, title);
    const arrayBuffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(arrayBuffer).set(bytes);
    downloadBlob(new Blob([arrayBuffer], { type: "application/epub+zip" }), fileName);
    return fileName;
  }

  const content = `${renderTextExport(input.format, blocks)}\n`;
  downloadBlob(new Blob([content], { type: "text/plain;charset=utf-8" }), fileName);
  return fileName;
};
