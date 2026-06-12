import path from "node:path";
import { writeFile } from "node:fs/promises";
import { dialog, type FileFilter } from "electron";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
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
