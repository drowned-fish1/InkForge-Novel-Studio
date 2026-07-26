import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { dialog, type FileFilter } from "electron";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { strToU8, strFromU8, unzipSync, zipSync, type Zippable } from "fflate";
import { marked, Renderer } from "marked";
import {
  ExportConfigSchema,
  runExportPreflight,
  type EpubExportConfig,
  type ExportConfig,
  type ExportPreflightIssue
} from "@inkforge/schemas";
import type { ExportInput } from "../types.js";
import { FileRepository } from "./FileRepository.js";
import { ProjectService } from "./ProjectService.js";

type ExportBlock = {
  kind: "volume" | "chapter";
  title?: string;
  body?: string;
};

export interface EpubVolumeInput {
  title: string;
  chapters: Array<{ title?: string; body: string }>;
}

export interface EpubBuildInput {
  identifier: string;
  config: EpubExportConfig;
  fallbackTitle: string;
  fallbackAuthor: string;
  fallbackDescription: string;
  volumes: EpubVolumeInput[];
  cover?: { data: Uint8Array; mediaType: "image/jpeg" | "image/png" };
  modifiedAt?: string;
}

export class ExportService {
  constructor(
    private readonly projects = new ProjectService(),
    private readonly files = new FileRepository()
  ) {}

  async loadExportConfig(projectPath: string): Promise<ExportConfig> {
    try {
      return ExportConfigSchema.parse(await this.files.readJson(this.configPath(projectPath)));
    } catch {
      return ExportConfigSchema.parse({});
    }
  }

  async saveExportConfig(projectPath: string, config: ExportConfig): Promise<ExportConfig> {
    const parsed = ExportConfigSchema.parse(config);
    await this.files.writeJsonAtomic(this.configPath(projectPath), parsed);
    return parsed;
  }

  async chooseCoverImage(): Promise<string | undefined> {
    const result = await dialog.showOpenDialog({
      title: "选择 EPUB 封面图片",
      properties: ["openFile"],
      filters: [{ name: "封面图片", extensions: ["jpg", "jpeg", "png"] }]
    });
    return result.canceled || !result.filePaths.length ? undefined : result.filePaths[0];
  }

  async preflight(projectPath: string): Promise<ExportPreflightIssue[]> {
    const project = await this.projects.openProject(projectPath);
    const config = await this.loadExportConfig(projectPath);
    const volumes = [] as Parameters<typeof runExportPreflight>[0]["volumes"];
    for (const volume of project.outline.volumes) {
      const chapters = [];
      for (const chapter of volume.chapters) {
        const content = chapter.archived
          ? ""
          : await this.files.readText(this.files.assertInsideProject(projectPath, chapter.file)).catch(() => "");
        chapters.push({ id: chapter.id, title: chapter.title, content, archived: chapter.archived });
      }
      volumes.push({ title: volume.title, chapters });
    }
    const coverExists = config.epub.coverImagePath
      ? await readFile(config.epub.coverImagePath)
          .then(() => true)
          .catch(() => false)
      : undefined;
    return runExportPreflight({ volumes, epub: config.epub, coverExists });
  }

  async exportManuscript(input: ExportInput): Promise<string | undefined> {
    const project = await this.projects.openProject(input.projectPath);
    const stored = await this.loadExportConfig(input.projectPath);
    const epubConfig: EpubExportConfig = input.epub
      ? {
          ...stored.epub,
          title: input.epub.title,
          author: input.epub.author,
          language: input.epub.language,
          description: input.epub.description,
          cssTheme: input.epub.cssTheme
        }
      : stored.epub;
    const includeChapterTitles = input.includeChapterTitles ?? stored.includeChapterTitles;
    const includeVolumeTitles = input.includeVolumeTitles ?? stored.includeVolumeTitles;

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
    const epubVolumes: EpubVolumeInput[] = [];
    for (const volume of project.outline.volumes) {
      if (includeVolumeTitles) {
        blocks.push({ kind: "volume", title: volume.title });
      }
      const epubChapters: EpubVolumeInput["chapters"] = [];
      for (const chapter of volume.chapters.filter((item) => !item.archived)) {
        const absolutePath = this.files.assertInsideProject(input.projectPath, chapter.file);
        const body = this.stripLeadingMarkdownTitle(await this.files.readText(absolutePath));
        blocks.push({
          kind: "chapter",
          title: includeChapterTitles ? chapter.title : undefined,
          body
        });
        epubChapters.push({ title: includeChapterTitles ? chapter.title : undefined, body });
      }
      epubVolumes.push({ title: volume.title, chapters: epubChapters });
    }

    if (input.format === "docx") {
      await this.writeDocx(result.filePath, project.meta.title, blocks);
    } else if (input.format === "epub") {
      let cover: EpubBuildInput["cover"];
      if (epubConfig.coverImagePath) {
        const data = await readFile(epubConfig.coverImagePath).catch(() => {
          throw new Error(`封面图片无法读取：${epubConfig.coverImagePath}`);
        });
        cover = { data: new Uint8Array(data), mediaType: coverMediaType(epubConfig.coverImagePath) };
      }
      const archive = buildEpubArchive({
        identifier: `urn:inkforge:${project.meta.projectId}`,
        config: { ...epubConfig, volumeTitlePages: epubConfig.volumeTitlePages && includeVolumeTitles },
        fallbackTitle: project.meta.title,
        fallbackAuthor: project.meta.author,
        fallbackDescription: project.outline.premise,
        volumes: epubVolumes,
        cover
      });
      const validation = validateEpubArchive(archive);
      if (validation.length) {
        throw new Error(`EPUB 结构校验未通过：${validation.join("；")}`);
      }
      await writeFile(result.filePath, Buffer.from(archive));
    } else {
      await this.files.writeTextAtomic(result.filePath, `${this.renderText(input.format, blocks)}\n`);
    }
    return result.filePath;
  }

  private configPath(projectPath: string): string {
    return this.files.assertInsideProject(projectPath, path.posix.join(".inkforge", "export.json"));
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
            spacing: { before: 280, after: 180 },
            pageBreakBefore: true
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
              spacing: { before: 240, after: 160 },
              pageBreakBefore: true
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

const coverMediaType = (filePath: string): "image/jpeg" | "image/png" => {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  throw new Error("封面仅支持 JPG 或 PNG 图片。");
};

const escapeXml = (value: string): string =>
  value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&apos;");

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

const xhtmlDocument = (language: string, title: string, body: string, cssHref = "../styles/book.css"): string =>
  `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="${escapeXml(language)}">
<head><title>${escapeXml(title)}</title><link rel="stylesheet" href="${cssHref}"/></head>
<body>${body}</body></html>`;

const buildCss = (config: EpubExportConfig): string => {
  const fontFamily = config.cssTheme === "modern" ? "system-ui,sans-serif" : "serif";
  const headingAlign = config.cssTheme === "modern" ? "" : "text-align:center;";
  const indent = config.paragraphIndent ? "text-indent:2em;" : "";
  return [
    `body{font-family:${fontFamily};line-height:${config.lineHeight};margin:6%;}`,
    `h1,h2{${headingAlign}line-height:1.3;}`,
    `p{${indent}margin:.55em 0;}`,
    ".volume-title{display:flex;align-items:center;justify-content:center;min-height:70vh;text-align:center;}",
    ".cover-image{display:block;width:100%;height:auto;margin:0 auto;}",
    ".copyright-page{margin-top:35vh;text-align:center;color:#555;font-size:.9em;}"
  ].join("\n");
};

/**
 * Builds a complete EPUB 3 archive: cover page + image, optional copyright
 * page, per-volume title pages, volume-nested nav (plus NCX for legacy
 * readers) and per-volume chapter numbering in fallback labels.
 */
export const buildEpubArchive = (input: EpubBuildInput): Uint8Array => {
  const config = input.config;
  const language = config.language.trim() || "zh-CN";
  const title = config.title.trim() || input.fallbackTitle;
  const author = config.author.trim() || input.fallbackAuthor;
  const description = config.description.trim() || input.fallbackDescription;
  const modified = (input.modifiedAt ?? new Date().toISOString()).replace(/\.\d{3}Z$/u, "Z");

  interface SpineEntry {
    id: string;
    file: string;
    label: string;
    content: string;
    inToc: boolean;
    children?: Array<{ file: string; label: string }>;
  }
  const entries: SpineEntry[] = [];

  if (input.cover) {
    entries.push({
      id: "cover-page",
      file: "cover.xhtml",
      label: "封面",
      inToc: true,
      content: xhtmlDocument(
        language,
        "封面",
        `<figure><img class="cover-image" src="../images/cover${input.cover.mediaType === "image/png" ? ".png" : ".jpg"}" alt="${escapeXml(title)}"/></figure>`
      )
    });
  }

  if (config.copyright.trim() || config.publisher.trim()) {
    const lines = [
      `<h2>${escapeXml(title)}</h2>`,
      author ? `<p>作者：${escapeXml(author)}</p>` : "",
      config.publisher.trim() ? `<p>出版：${escapeXml(config.publisher.trim())}</p>` : "",
      config.copyright.trim() ? `<p>${escapeXml(config.copyright.trim())}</p>` : ""
    ]
      .filter(Boolean)
      .join("\n");
    entries.push({
      id: "copyright-page",
      file: "copyright.xhtml",
      label: "版权信息",
      inToc: true,
      content: xhtmlDocument(language, "版权信息", `<section class="copyright-page">${lines}</section>`)
    });
  }

  input.volumes.forEach((volume, volumeIndex) => {
    const volumeLabel = volume.title.trim() || `第 ${volumeIndex + 1} 卷`;
    const chapterRefs: Array<{ file: string; label: string }> = [];
    let volumeEntry: SpineEntry | undefined;
    if (config.volumeTitlePages && input.volumes.length > 1) {
      volumeEntry = {
        id: `volume-${volumeIndex + 1}`,
        file: `volume-${volumeIndex + 1}.xhtml`,
        label: volumeLabel,
        inToc: true,
        content: xhtmlDocument(
          language,
          volumeLabel,
          `<section class="volume-title"><h1>${escapeXml(volumeLabel)}</h1></section>`
        ),
        children: chapterRefs
      };
      entries.push(volumeEntry);
    }
    volume.chapters.forEach((chapter, chapterIndex) => {
      const label = chapter.title?.trim() || `第 ${chapterIndex + 1} 章`;
      const file = `v${volumeIndex + 1}-c${chapterIndex + 1}.xhtml`;
      const headingMarkup = chapter.title ? `<h2>${escapeXml(chapter.title)}</h2>` : "";
      entries.push({
        id: `v${volumeIndex + 1}-c${chapterIndex + 1}`,
        file,
        label,
        inToc: !volumeEntry,
        content: xhtmlDocument(language, label, `${headingMarkup}${renderMarkdownAsXhtml(chapter.body)}`)
      });
      chapterRefs.push({ file, label });
    });
  });

  const manifestItems = entries
    .map((entry) => `<item id="${entry.id}" href="text/${entry.file}" media-type="application/xhtml+xml"/>`)
    .join("\n    ");
  const spineItems = entries.map((entry) => `<itemref idref="${entry.id}"/>`).join("\n    ");

  const tocItems = entries
    .filter((entry) => entry.inToc)
    .map((entry) => {
      const children = entry.children?.length
        ? `\n          <ol>${entry.children
            .map((child) => `<li><a href="text/${child.file}">${escapeXml(child.label)}</a></li>`)
            .join("")}</ol>\n        `
        : "";
      return `<li><a href="text/${entry.file}">${escapeXml(entry.label)}</a>${children}</li>`;
    })
    .join("\n        ");

  let playOrder = 0;
  const ncxNavPoint = (file: string, label: string, children = ""): string => {
    playOrder += 1;
    return `<navPoint id="np-${playOrder}" playOrder="${playOrder}"><navLabel><text>${escapeXml(
      label
    )}</text></navLabel><content src="text/${file}"/>${children}</navPoint>`;
  };
  const ncxPoints = entries
    .filter((entry) => entry.inToc)
    .map((entry) => {
      const childPoints = (entry.children ?? []).map((child) => ncxNavPoint(child.file, child.label)).join("");
      return ncxNavPoint(entry.file, entry.label, childPoints);
    })
    .join("\n    ");

  const coverManifest = input.cover
    ? `<item id="cover-image" href="images/cover${input.cover.mediaType === "image/png" ? ".png" : ".jpg"}" media-type="${input.cover.mediaType}" properties="cover-image"/>`
    : "";

  const firstContent = entries.find((entry) => entry.id !== "cover-page" && entry.id !== "copyright-page");
  const landmarks = [
    input.cover ? `<li><a epub:type="cover" href="text/cover.xhtml">封面</a></li>` : "",
    firstContent ? `<li><a epub:type="bodymatter" href="text/${firstContent.file}">正文</a></li>` : ""
  ]
    .filter(Boolean)
    .join("");

  const archive: Zippable = {
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'
    ),
    "OEBPS/styles/book.css": strToU8(buildCss(config)),
    "OEBPS/nav.xhtml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${escapeXml(language)}">
<head><title>目录</title><link rel="stylesheet" href="styles/book.css"/></head>
<body>
  <nav epub:type="toc"><h1>目录</h1><ol>${tocItems}</ol></nav>
  <nav epub:type="landmarks" hidden=""><h1>导航</h1><ol>${landmarks}</ol></nav>
</body></html>`),
    "OEBPS/toc.ncx": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${escapeXml(input.identifier)}"/>
    <meta name="dtb:depth" content="2"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${escapeXml(title)}</text></docTitle>
  <navMap>
    ${ncxPoints}
  </navMap>
</ncx>`),
    "OEBPS/content.opf": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${escapeXml(language)}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">${escapeXml(input.identifier)}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:creator>${escapeXml(author)}</dc:creator>
    <dc:language>${escapeXml(language)}</dc:language>
    <dc:description>${escapeXml(description)}</dc:description>
    ${config.publisher.trim() ? `<dc:publisher>${escapeXml(config.publisher.trim())}</dc:publisher>` : ""}
    ${config.copyright.trim() ? `<dc:rights>${escapeXml(config.copyright.trim())}</dc:rights>` : ""}
    ${input.cover ? '<meta name="cover" content="cover-image"/>' : ""}
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="styles/book.css" media-type="text/css"/>
    ${coverManifest}
    ${manifestItems}
  </manifest>
  <spine toc="ncx">${spineItems}</spine>
</package>`)
  };

  if (input.cover) {
    archive[`OEBPS/images/cover${input.cover.mediaType === "image/png" ? ".png" : ".jpg"}`] = [
      input.cover.data,
      { level: 0 }
    ];
  }
  for (const entry of entries) {
    archive[`OEBPS/text/${entry.file}`] = strToU8(entry.content);
  }

  return zipSync(archive, { level: 6 });
};

/**
 * Structural validation of a generated EPUB: required entries, spine/manifest
 * consistency and XML well-formedness of every XHTML/OPF/NCX document.
 * Returns a list of human-readable problems (empty = valid).
 */
export const validateEpubArchive = (data: Uint8Array): string[] => {
  const problems: string[] = [];
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data);
  } catch (error) {
    return [`无法解压 EPUB：${error instanceof Error ? error.message : String(error)}`];
  }
  for (const required of ["mimetype", "META-INF/container.xml", "OEBPS/content.opf", "OEBPS/nav.xhtml"]) {
    if (!files[required]) {
      problems.push(`缺少必需文件 ${required}`);
    }
  }
  if (files.mimetype && strFromU8(files.mimetype) !== "application/epub+zip") {
    problems.push("mimetype 内容不正确");
  }
  const opf = files["OEBPS/content.opf"] ? strFromU8(files["OEBPS/content.opf"]) : "";
  for (const [name, content] of Object.entries(files)) {
    if (/\.(?:xhtml|opf|ncx|xml)$/u.test(name)) {
      const error = findXmlWellFormednessError(strFromU8(content));
      if (error) {
        problems.push(`${name}: ${error}`);
      }
    }
  }
  if (opf) {
    const manifestHrefs = [...opf.matchAll(/href="([^"]+)"/gu)].map((match) => match[1]);
    for (const href of manifestHrefs) {
      if (!files[`OEBPS/${href}`]) {
        problems.push(`manifest 引用的文件不存在：${href}`);
      }
    }
    const manifestIds = new Set([...opf.matchAll(/<item id="([^"]+)"/gu)].map((match) => match[1]));
    for (const match of opf.matchAll(/<itemref idref="([^"]+)"/gu)) {
      if (!manifestIds.has(match[1])) {
        problems.push(`spine 引用了未在 manifest 声明的条目：${match[1]}`);
      }
    }
  }
  return problems;
};

/** Minimal XML well-formedness check: balanced tags, proper nesting. */
export const findXmlWellFormednessError = (source: string): string | undefined => {
  const stack: string[] = [];
  const tagPattern =
    /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/?([A-Za-z][\w:-]*)((?:"[^"]*"|'[^']*'|[^"'>])*)>/gu;
  let match: RegExpExecArray | null;
  let sawElement = false;
  while ((match = tagPattern.exec(source))) {
    if (match[1] === undefined) {
      continue;
    }
    sawElement = true;
    const name = match[1];
    const isClosing = match[0].startsWith("</");
    // XML has no void elements: only an explicit "/>" self-closes.
    const isSelfClosing = /\/>$/u.test(match[0]);
    if (isClosing) {
      const open = stack.pop();
      if (open !== name) {
        return `标签闭合不匹配：期待 </${open ?? "?"}>，实际 </${name}>`;
      }
    } else if (!isSelfClosing) {
      stack.push(name);
    }
  }
  if (!sawElement) {
    return "文档中没有任何元素";
  }
  if (stack.length) {
    return `存在未闭合标签：<${stack[stack.length - 1]}>`;
  }
  const bareAmpersand = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);)/iu.exec(source);
  if (bareAmpersand) {
    return "存在未转义的 & 字符";
  }
  return undefined;
};
