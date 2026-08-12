import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { dialog, type FileFilter } from "electron";
import { AlignmentType, Document, HeadingLevel, ImageRun, Packer, Paragraph, TextRun } from "docx";
import { strToU8, strFromU8, unzipSync, zipSync, type Zippable } from "fflate";
import { marked, Renderer } from "marked";
import {
  ExportConfigSchema,
  extractMarkdownImageSources,
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
  images?: Record<string, BodyImageResource>;
};

type BodyImageMediaType = "image/png" | "image/jpeg" | "image/gif";

interface BodyImageResource {
  id: string;
  fileName: string;
  data: Uint8Array;
  mediaType: BodyImageMediaType;
  docxType: "png" | "jpg" | "gif";
  width: number;
  height: number;
}

export interface EpubVolumeInput {
  title: string;
  chapters: Array<{ title?: string; body: string; imageHrefs?: Record<string, string> }>;
}

export interface EpubBuildInput {
  identifier: string;
  config: EpubExportConfig;
  fallbackTitle: string;
  fallbackAuthor: string;
  fallbackDescription: string;
  volumes: EpubVolumeInput[];
  cover?: { data: Uint8Array; mediaType: "image/jpeg" | "image/png" };
  images?: BodyImageResource[];
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
        const chapterPath = this.files.assertInsideProject(projectPath, chapter.file);
        const content = chapter.archived ? "" : await this.files.readText(chapterPath).catch(() => "");
        const imageAvailability = Object.fromEntries(
          await Promise.all(
            extractMarkdownImageSources(content).map(async (source, index) => [
              source,
              Boolean(await this.loadBodyImage(projectPath, chapterPath, source, `preflight-${index + 1}`))
            ])
          )
        );
        chapters.push({
          id: chapter.id,
          title: chapter.title,
          content,
          archived: chapter.archived,
          imageAvailability
        });
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
    const bodyImagesByPath = new Map<string, BodyImageResource>();
    for (const volume of project.outline.volumes) {
      if (includeVolumeTitles) {
        blocks.push({ kind: "volume", title: volume.title });
      }
      const epubChapters: EpubVolumeInput["chapters"] = [];
      for (const chapter of volume.chapters.filter((item) => !item.archived)) {
        const absolutePath = this.files.assertInsideProject(input.projectPath, chapter.file);
        const body = this.stripLeadingMarkdownTitle(await this.files.readText(absolutePath));
        const images = await this.collectBodyImages(input.projectPath, absolutePath, body, bodyImagesByPath);
        blocks.push({
          kind: "chapter",
          title: includeChapterTitles ? chapter.title : undefined,
          body,
          images: images.resourcesBySource
        });
        epubChapters.push({
          title: includeChapterTitles ? chapter.title : undefined,
          body,
          imageHrefs: images.epubHrefsBySource
        });
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
        cover,
        images: [...bodyImagesByPath.values()]
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
        children.push(...this.markdownToParagraphs(block.body ?? "", block.images));
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

  private resolveBodyImagePath(
    projectPath: string,
    chapterPath: string,
    source: string
  ): { absolutePath: string; mediaType: BodyImageMediaType; docxType: BodyImageResource["docxType"] } | undefined {
    const trimmed = source.trim();
    if (!trimmed || /^(?:https?:|data:|file:|mailto:|#)/iu.test(trimmed)) {
      return undefined;
    }
    let decoded: string;
    try {
      decoded = decodeURIComponent(trimmed.split(/[?#]/u, 1)[0]);
    } catch {
      return undefined;
    }
    try {
      const candidate = path.isAbsolute(decoded) ? decoded : path.resolve(path.dirname(chapterPath), decoded);
      const absolutePath = this.files.assertInsideProject(projectPath, candidate);
      const { mediaType, docxType } = bodyImageType(absolutePath);
      return { absolutePath, mediaType, docxType };
    } catch {
      return undefined;
    }
  }

  private async loadBodyImage(
    projectPath: string,
    chapterPath: string,
    source: string,
    id: string
  ): Promise<BodyImageResource | undefined> {
    const resolved = this.resolveBodyImagePath(projectPath, chapterPath, source);
    if (!resolved) {
      return undefined;
    }
    try {
      const data = new Uint8Array(await readFile(resolved.absolutePath));
      if (!data.byteLength || data.byteLength > 20 * 1024 * 1024) {
        return undefined;
      }
      const dimensions = imageDimensions(data, resolved.mediaType);
      return {
        id,
        fileName: `${id}.${resolved.docxType === "jpg" ? "jpg" : resolved.docxType}`,
        data,
        mediaType: resolved.mediaType,
        docxType: resolved.docxType,
        ...dimensions
      };
    } catch {
      return undefined;
    }
  }

  private async collectBodyImages(
    projectPath: string,
    chapterPath: string,
    markdown: string,
    resourcesByPath: Map<string, BodyImageResource>
  ): Promise<{ resourcesBySource: Record<string, BodyImageResource>; epubHrefsBySource: Record<string, string> }> {
    const resourcesBySource: Record<string, BodyImageResource> = {};
    const epubHrefsBySource: Record<string, string> = {};
    for (const source of extractMarkdownImageSources(markdown)) {
      const resolved = this.resolveBodyImagePath(projectPath, chapterPath, source);
      if (!resolved) {
        continue;
      }
      let resource = resourcesByPath.get(resolved.absolutePath);
      if (!resource) {
        resource = await this.loadBodyImage(projectPath, chapterPath, source, `body-image-${resourcesByPath.size + 1}`);
        if (!resource) {
          continue;
        }
        resourcesByPath.set(resolved.absolutePath, resource);
      }
      resourcesBySource[source] = resource;
      epubHrefsBySource[source] = `../images/${resource.fileName}`;
    }
    return { resourcesBySource, epubHrefsBySource };
  }

  private markdownToParagraphs(markdown: string, images: Record<string, BodyImageResource> = {}): Paragraph[] {
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

      const image = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/u.exec(line);
      if (image) {
        flush();
        const resource = images[image[2].trim()];
        if (resource) {
          const transformation = fitImage(resource.width, resource.height, 560, 720);
          paragraphs.push(
            new Paragraph({
              children: [
                new ImageRun({
                  type: resource.docxType,
                  data: resource.data,
                  transformation
                })
              ],
              alignment: AlignmentType.CENTER,
              spacing: { before: 120, after: image[1].trim() ? 60 : 160 }
            })
          );
          if (image[1].trim()) {
            paragraphs.push(
              new Paragraph({
                text: image[1].trim(),
                alignment: AlignmentType.CENTER,
                spacing: { after: 160 }
              })
            );
          }
        } else if (image[1].trim()) {
          paragraphs.push(new Paragraph({ text: image[1].trim(), spacing: { after: 160 } }));
        }
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

const bodyImageType = (
  filePath: string
): { mediaType: BodyImageMediaType; docxType: BodyImageResource["docxType"] } => {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".png")) {
    return { mediaType: "image/png", docxType: "png" };
  }
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return { mediaType: "image/jpeg", docxType: "jpg" };
  }
  if (lower.endsWith(".gif")) {
    return { mediaType: "image/gif", docxType: "gif" };
  }
  throw new Error("正文图片仅支持 PNG、JPG 或 GIF。");
};

const imageDimensions = (data: Uint8Array, mediaType: BodyImageMediaType): { width: number; height: number } => {
  if (mediaType === "image/png" && data.length >= 24) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (mediaType === "image/gif" && data.length >= 10) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  }
  if (mediaType === "image/jpeg") {
    let offset = 2;
    while (offset + 9 < data.length) {
      if (data[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = data[offset + 1];
      const segmentLength = (data[offset + 2] << 8) | data[offset + 3];
      if (marker >= 0xc0 && marker <= 0xc3 && segmentLength >= 7) {
        return {
          width: (data[offset + 7] << 8) | data[offset + 8],
          height: (data[offset + 5] << 8) | data[offset + 6]
        };
      }
      if (segmentLength < 2) {
        break;
      }
      offset += segmentLength + 2;
    }
  }
  return { width: 1200, height: 800 };
};

const fitImage = (
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number
): { width: number; height: number } => {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const scale = Math.min(1, maxWidth / safeWidth, maxHeight / safeHeight);
  return { width: Math.round(safeWidth * scale), height: Math.round(safeHeight * scale) };
};

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

const createEpubRenderer = (imageHrefs: Record<string, string>): Renderer => {
  const renderer = new Renderer();
  renderer.html = ({ text }) => escapeXml(text);
  renderer.hr = () => "<hr />\n";
  renderer.br = () => "<br />\n";
  renderer.checkbox = ({ checked }) => (checked ? "☒ " : "☐ ");
  renderer.image = ({ href, text, title }) => {
    const embeddedHref = imageHrefs[href.trim()];
    if (!embeddedHref) {
      return `<span class="image-alt">${escapeXml(text)}</span>`;
    }
    const caption = text.trim() ? `<figcaption>${escapeXml(text.trim())}</figcaption>` : "";
    const titleAttribute = title ? ` title="${escapeXml(title)}"` : "";
    return `<figure class="body-figure"><img class="body-image" src="${escapeXml(embeddedHref)}" alt="${escapeXml(text)}"${titleAttribute}/>${caption}</figure>`;
  };
  renderer.link = function ({ href, title, tokens }) {
    const label = this.parser.parseInline(tokens);
    const normalizedHref = href.trim();
    if (!/^(?:https?:|mailto:|#)/iu.test(normalizedHref)) {
      return label;
    }
    const titleAttribute = title ? ` title="${escapeXml(title)}"` : "";
    return `<a href="${escapeXml(normalizedHref)}"${titleAttribute}>${label}</a>`;
  };
  return renderer;
};

export const renderMarkdownAsXhtml = (markdown: string, imageHrefs: Record<string, string> = {}): string =>
  String(marked.parse(markdown, { async: false, renderer: createEpubRenderer(imageHrefs) })).replace(
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
    ".body-figure{margin:1.2em auto;text-align:center;}",
    ".body-image{display:block;max-width:100%;height:auto;margin:0 auto;}",
    ".body-figure figcaption{margin-top:.45em;color:#666;font-size:.85em;text-indent:0;}",
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
        content: xhtmlDocument(
          language,
          label,
          `${headingMarkup}${renderMarkdownAsXhtml(chapter.body, chapter.imageHrefs)}`
        )
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
  const bodyImageManifest = (input.images ?? [])
    .map(
      (image) =>
        `<item id="${escapeXml(image.id)}" href="images/${escapeXml(image.fileName)}" media-type="${image.mediaType}"/>`
    )
    .join("\n    ");

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
    ${bodyImageManifest}
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
  for (const image of input.images ?? []) {
    archive[`OEBPS/images/${image.fileName}`] = [image.data, { level: 0 }];
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
