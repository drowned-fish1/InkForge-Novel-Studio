import path from "node:path";
import { writeFile } from "node:fs/promises";
import { dialog, type FileFilter } from "electron";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { strToU8, zipSync, type Zippable } from "fflate";
import { marked, Renderer } from "marked";
import type { ExportInput } from "../types.js";
import { FileRepository } from "./FileRepository.js";
import { ProjectService } from "./ProjectService.js";

type ExportBlock = {
  kind: "volume" | "chapter";
  title?: string;
  body?: string;
};

export class ExportService {
  constructor(
    private readonly projects = new ProjectService(),
    private readonly files = new FileRepository()
  ) {}

  async exportManuscript(input: ExportInput): Promise<string | undefined> {
    const project = await this.projects.openProject(input.projectPath);
    const extension = input.format === "markdown" ? "md" : input.format;
    const defaultName = `${project.meta.title}.${extension}`;
    const result = await dialog.showSaveDialog({
      title: "导出小说正文",
      defaultPath: path.join(input.projectPath, "exports", defaultName),
      filters: [this.filterFor(input.format)]
    });
    if (result.canceled || !result.filePath) {
      return undefined;
    }

    const blocks: ExportBlock[] = [];
    for (const volume of project.outline.volumes) {
      if (input.includeVolumeTitles) {
        blocks.push({ kind: "volume", title: volume.title });
      }
      for (const chapter of volume.chapters.filter((item) => !item.archived)) {
        const absolutePath = this.files.assertInsideProject(input.projectPath, chapter.file);
        const body = await this.files.readText(absolutePath);
        blocks.push({
          kind: "chapter",
          title: input.includeChapterTitles ? chapter.title : undefined,
          body: this.stripLeadingMarkdownTitle(body)
        });
      }
    }

    if (input.format === "docx") {
      await this.writeDocx(result.filePath, project.meta.title, blocks);
    } else if (input.format === "epub") {
      await this.writeEpub(result.filePath, {
        identifier: project.meta.projectId,
        title: input.epub?.title.trim() || project.meta.title,
        author: input.epub?.author.trim() || project.meta.author,
        language: input.epub?.language.trim() || "zh-CN",
        description: input.epub?.description.trim() || project.outline.premise,
        theme: input.epub?.cssTheme ?? "classic",
        blocks
      });
    } else {
      await this.files.writeTextAtomic(result.filePath, `${this.renderText(input.format, blocks)}\n`);
    }
    return result.filePath;
  }

  private filterFor(format: ExportInput["format"]): FileFilter {
    if (format === "markdown") {
      return { name: "Markdown", extensions: ["md"] };
    }
    if (format === "docx") {
      return { name: "Word Document", extensions: ["docx"] };
    }
    if (format === "epub") {
      return { name: "EPUB Electronic Book", extensions: ["epub"] };
    }
    return { name: "Text", extensions: ["txt"] };
  }

  private renderText(format: "markdown" | "txt", blocks: ExportBlock[]): string {
    return blocks
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
  }

  private async writeDocx(filePath: string, title: string, blocks: ExportBlock[]): Promise<void> {
    const children = [
      new Paragraph({
        text: title,
        heading: HeadingLevel.TITLE,
        spacing: { after: 360 }
      })
    ];

    for (const block of blocks) {
      if (block.kind === "volume" && block.title) {
        children.push(
          new Paragraph({
            text: block.title,
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 280, after: 180 }
          })
        );
        continue;
      }
      if (block.kind === "chapter") {
        if (block.title) {
          children.push(
            new Paragraph({
              text: block.title,
              heading: HeadingLevel.HEADING_2,
              spacing: { before: 240, after: 160 }
            })
          );
        }
        children.push(...this.markdownToParagraphs(block.body ?? ""));
      }
    }

    const doc = new Document({
      creator: "InkForge Local Novel Studio",
      title,
      sections: [
        {
          properties: {
            page: {
              margin: {
                top: 1134,
                right: 1134,
                bottom: 1134,
                left: 1134
              }
            }
          },
          children
        }
      ]
    });
    const buffer = await Packer.toBuffer(doc);
    await writeFile(filePath, buffer);
  }

  private async writeEpub(
    filePath: string,
    input: {
      identifier: string;
      title: string;
      author: string;
      language: string;
      description: string;
      theme: "classic" | "modern";
      blocks: ExportBlock[];
    }
  ): Promise<void> {
    const publicationId = escapeXml(input.identifier);
    const chapters = input.blocks.map((block, index) => ({
      ...block,
      id: `section-${index + 1}`,
      file: `section-${index + 1}.xhtml`,
      label: block.title || (block.kind === "volume" ? `第 ${index + 1} 卷` : `第 ${index + 1} 章`)
    }));
    const manifest = chapters
      .map((chapter) => `<item id="${chapter.id}" href="text/${chapter.file}" media-type="application/xhtml+xml"/>`)
      .join("\n    ");
    const spine = chapters.map((chapter) => `<itemref idref="${chapter.id}"/>`).join("\n    ");
    const nav = chapters
      .map((chapter) => `<li><a href="text/${chapter.file}">${escapeXml(chapter.label)}</a></li>`)
      .join("\n        ");
    const css =
      input.theme === "modern"
        ? "body{font-family:system-ui,sans-serif;line-height:1.85;margin:6%;color:#152b26}h1,h2{line-height:1.25}p{text-indent:2em;margin:.55em 0}"
        : "body{font-family:serif;line-height:1.9;margin:7%;color:#221f1a}h1,h2{text-align:center;line-height:1.35;margin:2em 0 1.4em}p{text-indent:2em;margin:.6em 0}";

    const archive: Zippable = {
      mimetype: [strToU8("application/epub+zip"), { level: 0 }],
      "META-INF/container.xml": strToU8(
        '<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'
      ),
      "OEBPS/styles/book.css": strToU8(css),
      "OEBPS/nav.xhtml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${escapeXml(input.language)}">
<head><title>目录</title><link rel="stylesheet" href="styles/book.css"/></head>
<body><nav epub:type="toc"><h1>目录</h1><ol>${nav}</ol></nav></body></html>`),
      "OEBPS/content.opf": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${escapeXml(input.language)}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">${publicationId}</dc:identifier>
    <dc:title>${escapeXml(input.title)}</dc:title>
    <dc:creator>${escapeXml(input.author)}</dc:creator>
    <dc:language>${escapeXml(input.language)}</dc:language>
    <dc:description>${escapeXml(input.description)}</dc:description>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/u, "Z")}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="styles/book.css" media-type="text/css"/>
    ${manifest}
  </manifest>
  <spine>${spine}</spine>
</package>`)
    };

    for (const chapter of chapters) {
      const heading = chapter.kind === "volume" ? "h1" : "h2";
      const headingMarkup = chapter.title ? `<${heading}>${escapeXml(chapter.title)}</${heading}>` : "";
      const body = chapter.body ? renderMarkdownAsXhtml(chapter.body) : "";
      archive[`OEBPS/text/${chapter.file}`] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="${escapeXml(input.language)}">
<head><title>${escapeXml(chapter.label)}</title><link rel="stylesheet" href="../styles/book.css"/></head>
<body>${headingMarkup}${body}</body></html>`);
    }

    await writeFile(filePath, Buffer.from(zipSync(archive, { level: 6 })));
  }

  private stripLeadingMarkdownTitle(markdown: string): string {
    return markdown.replace(/^\s*#\s+.+?(?:\r?\n)+(?:\r?\n)*/u, "").trim();
  }

  private markdownToParagraphs(markdown: string): Paragraph[] {
    const lines = markdown.replace(/\r\n/g, "\n").split("\n");
    const paragraphs: Paragraph[] = [];
    let buffer: string[] = [];

    const flush = () => {
      const text = buffer.join(" ").trim();
      if (text) {
        paragraphs.push(
          new Paragraph({
            children: this.markdownInlineRuns(text),
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
          new Paragraph({
            text: heading[2],
            heading: heading[1].length <= 2 ? HeadingLevel.HEADING_3 : HeadingLevel.HEADING_4,
            spacing: { before: 180, after: 120 }
          })
        );
        continue;
      }

      const unordered = /^[-*+]\s+(.+)$/u.exec(line);
      if (unordered) {
        flush();
        paragraphs.push(
          new Paragraph({
            children: this.markdownInlineRuns(unordered[1]),
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
          new Paragraph({
            children: this.markdownInlineRuns(`${line.match(/^\d+/u)?.[0] ?? "1"}. ${ordered[1]}`),
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
          new Paragraph({
            children: this.markdownInlineRuns(quote[1]),
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
  }

  private markdownInlineRuns(text: string): TextRun[] {
    const runs: TextRun[] = [];
    const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/gu;
    let index = 0;

    for (const match of text.matchAll(pattern)) {
      if (match.index > index) {
        runs.push(new TextRun({ text: text.slice(index, match.index), size: 24 }));
      }
      const token = match[0];
      if (token.startsWith("`")) {
        runs.push(new TextRun({ text: token.slice(1, -1), size: 22, font: "Consolas" }));
      } else if (token.startsWith("**")) {
        runs.push(new TextRun({ text: token.slice(2, -2), size: 24, bold: true }));
      } else {
        runs.push(new TextRun({ text: token.slice(1, -1), size: 24, italics: true }));
      }
      index = match.index + token.length;
    }

    if (index < text.length) {
      runs.push(new TextRun({ text: text.slice(index), size: 24 }));
    }
    return runs.length ? runs : [new TextRun({ text: "", size: 24 })];
  }
}

const escapeXml = (value: string): string =>
  value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;");

const epubRenderer = new Renderer();
epubRenderer.html = ({ text }) => escapeXml(text);
epubRenderer.hr = () => "<hr />\n";
epubRenderer.br = () => "<br />\n";
epubRenderer.checkbox = ({ checked }) => (checked ? "☒ " : "☐ ");
epubRenderer.image = ({ text }) => `<span class="image-alt">${escapeXml(text)}</span>`;
epubRenderer.link = function ({ href, title, tokens }) {
  const label = this.parser.parseInline(tokens);
  const normalizedHref = href.trim();
  if (!/^(?:https?:|mailto:|#)/iu.test(normalizedHref)) {
    return label;
  }
  const titleAttribute = title ? ` title="${escapeXml(title)}"` : "";
  return `<a href="${escapeXml(normalizedHref)}"${titleAttribute}>${label}</a>`;
};

export const renderMarkdownAsXhtml = (markdown: string): string =>
  String(marked.parse(markdown, { async: false, renderer: epubRenderer })).replace(
    /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);)/giu,
    "&amp;"
  );
