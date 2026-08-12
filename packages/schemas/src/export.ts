import { z } from "zod";

export const EpubExportConfigSchema = z.object({
  title: z.string().default(""),
  author: z.string().default(""),
  language: z.string().default("zh-CN"),
  description: z.string().default(""),
  publisher: z.string().default(""),
  copyright: z.string().default(""),
  coverImagePath: z.string().default(""),
  cssTheme: z.enum(["classic", "modern"]).default("classic"),
  lineHeight: z.number().min(1.2).max(3).default(1.9),
  paragraphIndent: z.boolean().default(true),
  volumeTitlePages: z.boolean().default(true)
});

export const ExportConfigSchema = z.object({
  includeChapterTitles: z.boolean().default(true),
  includeVolumeTitles: z.boolean().default(true),
  epub: EpubExportConfigSchema.default({
    title: "",
    author: "",
    language: "zh-CN",
    description: "",
    publisher: "",
    copyright: "",
    coverImagePath: "",
    cssTheme: "classic",
    lineHeight: 1.9,
    paragraphIndent: true,
    volumeTitlePages: true
  })
});

export type EpubExportConfig = z.infer<typeof EpubExportConfigSchema>;
export type ExportConfig = z.infer<typeof ExportConfigSchema>;

export interface ExportPreflightIssue {
  id: string;
  severity: "error" | "warning" | "info";
  kind: "empty-chapter" | "duplicate-title" | "invalid-link" | "missing-resource" | "metadata";
  title: string;
  detail: string;
  chapterId?: string;
}

export interface ExportPreflightInput {
  volumes: Array<{
    title: string;
    chapters: Array<{
      id: string;
      title: string;
      content: string;
      archived?: boolean;
      imageAvailability?: Record<string, boolean>;
    }>;
  }>;
  epub: Pick<EpubExportConfig, "title" | "author" | "coverImagePath">;
  coverExists?: boolean;
}

const markdownLinkPattern = /\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu;
const markdownImagePattern = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu;

export const extractMarkdownImageSources = (markdown: string): string[] =>
  [...markdown.matchAll(markdownImagePattern)].map((match) => match[2].trim());

/**
 * Local pre-export checks shared by the desktop service and the browser
 * mirror: empty chapters, duplicate titles, links that the EPUB renderer
 * drops, and image references that cannot be resolved safely for embedding.
 */
export const runExportPreflight = (input: ExportPreflightInput): ExportPreflightIssue[] => {
  const issues: ExportPreflightIssue[] = [];
  const chapterTitleCounts = new Map<string, number>();
  const volumeTitleCounts = new Map<string, number>();

  for (const volume of input.volumes) {
    volumeTitleCounts.set(volume.title.trim(), (volumeTitleCounts.get(volume.title.trim()) ?? 0) + 1);
    for (const chapter of volume.chapters) {
      if (chapter.archived) {
        continue;
      }
      const trimmed = chapter.content.trim();
      if (trimmed.length < 20) {
        issues.push({
          id: `empty-${chapter.id}`,
          severity: "error",
          kind: "empty-chapter",
          title: "章节内容为空或过短",
          detail: `《${chapter.title}》正文只有 ${trimmed.length} 个字符，导出后会是空白章节。`,
          chapterId: chapter.id
        });
      }
      chapterTitleCounts.set(chapter.title.trim(), (chapterTitleCounts.get(chapter.title.trim()) ?? 0) + 1);

      for (const match of chapter.content.matchAll(markdownImagePattern)) {
        const source = match[2].trim();
        const availability = chapter.imageAvailability?.[source];
        if (availability === true) {
          continue;
        }
        issues.push({
          id: `image-${chapter.id}-${match.index}`,
          severity: "warning",
          kind: "missing-resource",
          title: availability === false ? "正文图片无法嵌入" : "正文图片需要桌面端确认",
          detail:
            availability === false
              ? `《${chapter.title}》引用的图片 ${source} 不存在、格式不支持或超出项目目录，导出时会保留替代文字。`
              : `《${chapter.title}》引用图片 ${source}。桌面端会嵌入可读取的 PNG/JPG/GIF；浏览器预览无法读取项目相对文件。`,
          chapterId: chapter.id
        });
      }
      for (const match of chapter.content.matchAll(markdownLinkPattern)) {
        const href = match[2].trim();
        if (match[0].startsWith("!")) {
          continue;
        }
        if (!/^(?:https?:|mailto:|#)/iu.test(href)) {
          issues.push({
            id: `link-${chapter.id}-${match.index}`,
            severity: "warning",
            kind: "invalid-link",
            title: "无效链接会被移除",
            detail: `《${chapter.title}》包含相对链接 ${href}，EPUB 导出会移除链接只保留文字。`,
            chapterId: chapter.id
          });
        }
      }
    }
  }

  for (const [title, count] of chapterTitleCounts) {
    if (count > 1 && title) {
      issues.push({
        id: `dup-chapter-${title}`,
        severity: "warning",
        kind: "duplicate-title",
        title: "章节标题重复",
        detail: `${count} 个章节使用了同一标题「${title}」，目录中难以区分。`
      });
    }
  }
  for (const [title, count] of volumeTitleCounts) {
    if (count > 1 && title) {
      issues.push({
        id: `dup-volume-${title}`,
        severity: "warning",
        kind: "duplicate-title",
        title: "分卷标题重复",
        detail: `${count} 个分卷使用了同一标题「${title}」。`
      });
    }
  }

  if (input.epub.coverImagePath && input.coverExists === false) {
    issues.push({
      id: "cover-missing",
      severity: "error",
      kind: "missing-resource",
      title: "封面图片不存在",
      detail: `配置的封面 ${input.epub.coverImagePath} 无法读取，导出会失败或缺少封面。`
    });
  }
  if (!input.epub.title.trim()) {
    issues.push({
      id: "meta-title",
      severity: "info",
      kind: "metadata",
      title: "未单独设置书名",
      detail: "EPUB 将使用项目名作为书名。"
    });
  }
  if (!input.epub.author.trim()) {
    issues.push({
      id: "meta-author",
      severity: "info",
      kind: "metadata",
      title: "未单独设置作者名",
      detail: "EPUB 将使用项目作者字段。"
    });
  }

  return issues;
};
