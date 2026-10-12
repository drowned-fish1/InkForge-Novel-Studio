import { strFromU8, unzipSync } from "fflate";

export interface EpubImportChapter {
  title: string;
  body: string;
  sourcePath: string;
}

export interface ParsedEpub {
  title: string;
  author: string;
  language: string;
  chapters: EpubImportChapter[];
  warnings: string[];
}

interface ManifestItem {
  id: string;
  path: string;
  mediaType: string;
  properties: Set<string>;
}

interface HtmlSection {
  title?: string;
  html: string;
}

const MAX_EPUB_BYTES = 128 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 10_000;
const MAX_DOCUMENT_BYTES = 16 * 1024 * 1024;
const SKIPPABLE_PAGE_TITLE =
  /^(?:cover|cover page|title page|copyright|copyright page|table of contents|toc|navigation|nav|封面|扉页|版权|版权页|目录|导航)$/iu;
const FRONT_MATTER_PATH = /(?:^|[-_/])(?:cover|copyright|title[-_ ]?page|toc|nav|封面|版权|目录|扉页)(?:[-_. /]|$)/iu;

const decodeEntities = (value: string): string =>
  value.replace(/&(#x[\da-f]+|#\d+|amp|apos|gt|lt|nbsp|quot);/giu, (match, entity: string) => {
    const normalized = entity.toLowerCase();
    if (normalized.startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(normalized.slice(2), 16));
    }
    if (normalized.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(normalized.slice(1), 10));
    }
    return (
      {
        amp: "&",
        apos: "'",
        gt: ">",
        lt: "<",
        nbsp: " ",
        quot: '"'
      }[normalized] ?? match
    );
  });

const plainText = (value: string): string =>
  decodeEntities(
    value
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/giu, "$1")
      .replace(/<rt\b[^>]*>[\s\S]*?<\/rt>/giu, "")
      .replace(/<rp\b[^>]*>[\s\S]*?<\/rp>/giu, "")
      .replace(/<[^>]+>/gu, " ")
  )
    .replace(/\s+/gu, " ")
    .trim();

const attributesOf = (tag: string): Record<string, string> => {
  const attributes: Record<string, string> = {};
  const pattern = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gu;
  for (const match of tag.matchAll(pattern)) {
    attributes[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? "");
  }
  return attributes;
};

const firstElementText = (xml: string, localName: string): string => {
  const pattern = new RegExp(`<(?:[\\w.-]+:)?${localName}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${localName}>`, "iu");
  return plainText(pattern.exec(xml)?.[1] ?? "");
};

const decodePathComponent = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const normalizeArchivePath = (baseFile: string, href: string): string | undefined => {
  const cleanHref = decodePathComponent(href.split(/[?#]/u, 1)[0].replace(/\\/gu, "/")).replace(/^\/+/, "");
  const baseParts = baseFile.replace(/\\/gu, "/").split("/").slice(0, -1);
  const sourceParts = href.startsWith("/") ? [] : baseParts;
  const result = [...sourceParts];
  for (const part of cleanHref.split("/")) {
    if (!part || part === ".") {
      continue;
    }
    if (part === "..") {
      if (!result.length) {
        return undefined;
      }
      result.pop();
      continue;
    }
    result.push(part);
  }
  return result.join("/");
};

const archiveLookup = (archive: Record<string, Uint8Array>): Map<string, string> =>
  new Map(Object.keys(archive).map((path) => [path.replace(/\\/gu, "/").toLowerCase(), path]));

const findArchiveEntry = (
  archive: Record<string, Uint8Array>,
  lookup: Map<string, string>,
  path: string
): Uint8Array | undefined => archive[path] ?? archive[lookup.get(path.toLowerCase()) ?? ""];

const readArchiveText = (
  archive: Record<string, Uint8Array>,
  lookup: Map<string, string>,
  path: string
): string | undefined => {
  const bytes = findArchiveEntry(archive, lookup, path);
  if (!bytes) {
    return undefined;
  }
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) {
    throw new Error(`EPUB 内文档过大：${path}`);
  }
  return strFromU8(bytes);
};

const extractBody = (html: string): string => /<body\b[^>]*>([\s\S]*?)<\/body>/iu.exec(html)?.[1] ?? html;

const protectCode = (html: string, blocks: string[]): string =>
  html
    .replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/giu, (_, code: string) => {
      const token = `\uE000${blocks.length}\uE001`;
      blocks.push(`\n\n\`\`\`\n${decodeEntities(code.replace(/<[^>]+>/gu, "")).trim()}\n\`\`\`\n\n`);
      return token;
    })
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/giu, (_, code: string) => {
      const token = `\uE000${blocks.length}\uE001`;
      blocks.push(`\`${decodeEntities(code.replace(/<[^>]+>/gu, "")).trim()}\``);
      return token;
    });

const inlineText = (html: string): string => plainText(html).replace(/([\\`*_{}[\]()#+.!|>~-])/gu, "\\$1");

export const xhtmlToMarkdown = (source: string): string => {
  const blocks: string[] = [];
  let html = extractBody(source)
    .replace(/<!--([\s\S]*?)-->/gu, "")
    .replace(
      /<(?:script|style|nav|svg|audio|video|canvas|form|object|iframe)\b[^>]*>[\s\S]*?<\/(?:script|style|nav|svg|audio|video|canvas|form|object|iframe)>/giu,
      ""
    )
    .replace(/<(?:script|style|nav|svg|audio|video|canvas|form|object|iframe)\b[^>]*\/?\s*>/giu, "")
    .replace(/<rt\b[^>]*>[\s\S]*?<\/rt>/giu, "")
    .replace(/<rp\b[^>]*>[\s\S]*?<\/rp>/giu, "");

  html = protectCode(html, blocks)
    .replace(/<img\b[^>]*>/giu, (tag) => {
      const alt = attributesOf(tag).alt?.trim();
      return alt ? `【插图：${alt}】` : "【插图】";
    })
    .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/giu, (tag, label: string) => {
      const text = inlineText(label);
      const href = attributesOf(tag).href?.trim() ?? "";
      return /^https?:\/\//iu.test(href) && text ? `[${text}](${href})` : text;
    })
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/giu, "**$2**")
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/giu, "*$2*")
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/giu, (_, level: string, title: string) => {
      return `\n\n${"#".repeat(Number(level))} ${plainText(title)}\n\n`;
    })
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/giu, (_, item: string) => `\n- ${plainText(item)}`)
    .replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/giu, (_, quote: string) => {
      const text = plainText(quote);
      return text ? `\n\n> ${text}\n\n` : "";
    })
    .replace(/<tr\b[^>]*>([\s\S]*?)<\/tr>/giu, "$1\n")
    .replace(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/giu, "$1\t")
    .replace(/<br\s*\/?\s*>/giu, "\n")
    .replace(/<hr\b[^>]*\/?\s*>/giu, "\n\n---\n\n")
    .replace(/<\/(?:p|div|section|article|aside|header|footer|figure|figcaption|ul|ol|dl|table)>/giu, "\n\n")
    .replace(/<(?:p|div|section|article|aside|header|footer|figure|figcaption|ul|ol|dl|table)\b[^>]*>/giu, "\n\n")
    .replace(/<[^>]+>/gu, "");

  html = decodeEntities(html);
  html = html.replace(/\uE000(\d+)\uE001/gu, (_, index: string) => blocks[Number(index)] ?? "");
  return html
    .replace(/[\t \f\v]+\n/gu, "\n")
    .replace(/\n[\t \f\v]+/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
};

const splitHtmlSections = (html: string): HtmlSection[] => {
  const body = extractBody(html);
  const h1 = Array.from(body.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/giu));
  const headings = h1.length ? h1 : Array.from(body.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/giu));
  if (!headings.length) {
    return [{ html: body }];
  }

  if (headings.length === 1) {
    const heading = headings[0];
    return [
      {
        title: plainText(heading[1]),
        html: `${body.slice(0, heading.index)}${body.slice((heading.index ?? 0) + heading[0].length)}`
      }
    ];
  }

  const sections: HtmlSection[] = [];
  const preamble = body.slice(0, headings[0].index);
  if (plainText(preamble)) {
    sections.push({ html: preamble });
  }
  headings.forEach((heading, index) => {
    const start = (heading.index ?? 0) + heading[0].length;
    const end = headings[index + 1]?.index ?? body.length;
    sections.push({ title: plainText(heading[1]), html: body.slice(start, end) });
  });
  return sections;
};

const titleFromDocument = (html: string, sourcePath: string): string => {
  const title = firstElementText(html, "title");
  if (title) {
    return title;
  }
  const filename = sourcePath.split("/").at(-1) ?? sourcePath;
  return decodePathComponent(filename.replace(/\.(?:xhtml?|html?)$/iu, ""))
    .replace(/[_-]+/gu, " ")
    .trim();
};

const readNavigationLabels = (
  archive: Record<string, Uint8Array>,
  lookup: Map<string, string>,
  opfPath: string,
  manifest: ManifestItem[]
): Map<string, string> => {
  const labels = new Map<string, string>();
  const navItem = manifest.find((item) => item.properties.has("nav"));
  const ncxItem = manifest.find((item) => item.mediaType === "application/x-dtbncx+xml");

  if (navItem) {
    const nav = readArchiveText(archive, lookup, navItem.path);
    if (nav) {
      for (const match of nav.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/giu)) {
        const href = attributesOf(match[0]).href;
        const path = href ? normalizeArchivePath(navItem.path, href) : undefined;
        const label = plainText(match[0]);
        if (path && label && !labels.has(path)) {
          labels.set(path, label);
        }
      }
    }
  }

  if (ncxItem) {
    const ncx = readArchiveText(archive, lookup, ncxItem.path);
    if (ncx) {
      for (const match of ncx.matchAll(/<navPoint\b[^>]*>([\s\S]*?)<content\b[^>]*\/?\s*>/giu)) {
        const contentTag = /<content\b[^>]*\/?\s*>/iu.exec(match[0])?.[0] ?? "";
        const href = attributesOf(contentTag).src;
        const path = href ? normalizeArchivePath(ncxItem.path, href) : undefined;
        const label = firstElementText(match[1], "text");
        if (path && label && !labels.has(path)) {
          labels.set(path, label);
        }
      }
    }
  }

  return labels;
};

export const parseEpub = (bytes: Uint8Array): ParsedEpub => {
  if (!bytes.byteLength) {
    throw new Error("EPUB 文件为空。");
  }
  if (bytes.byteLength > MAX_EPUB_BYTES) {
    throw new Error("EPUB 文件超过 128 MB，暂不支持直接导入。");
  }

  let archive: Record<string, Uint8Array>;
  try {
    archive = unzipSync(bytes);
  } catch {
    throw new Error("EPUB 压缩包损坏或使用了不支持的加密方式。");
  }
  const entries = Object.entries(archive);
  if (entries.length > MAX_ARCHIVE_ENTRIES) {
    throw new Error("EPUB 内文件数量异常，已停止导入。");
  }
  const totalBytes = entries.reduce((total, [, entry]) => total + entry.byteLength, 0);
  if (totalBytes > MAX_UNCOMPRESSED_BYTES) {
    throw new Error("EPUB 解压后超过 512 MB，已停止导入。");
  }

  const lookup = archiveLookup(archive);
  const container = readArchiveText(archive, lookup, "META-INF/container.xml");
  let opfPath: string | undefined;
  if (container) {
    const rootfileTag = /<rootfile\b[^>]*>/iu.exec(container)?.[0];
    const fullPath = rootfileTag ? attributesOf(rootfileTag)["full-path"] : undefined;
    opfPath = fullPath ? normalizeArchivePath("", fullPath) : undefined;
  }
  opfPath ??= Object.keys(archive).find((path) => path.toLowerCase().endsWith(".opf"));
  if (!opfPath) {
    throw new Error("EPUB 缺少 OPF 内容清单。");
  }

  const opf = readArchiveText(archive, lookup, opfPath);
  if (!opf) {
    throw new Error("EPUB 的 OPF 内容清单无法读取。");
  }

  const manifest: ManifestItem[] = Array.from(opf.matchAll(/<item\b[^>]*>/giu)).flatMap((match) => {
    const attributes = attributesOf(match[0]);
    const path = attributes.href ? normalizeArchivePath(opfPath, attributes.href) : undefined;
    if (!attributes.id || !path) {
      return [];
    }
    return [
      {
        id: attributes.id,
        path,
        mediaType: attributes["media-type"]?.toLowerCase() ?? "",
        properties: new Set((attributes.properties ?? "").toLowerCase().split(/\s+/u).filter(Boolean))
      }
    ];
  });
  const byId = new Map(manifest.map((item) => [item.id, item]));
  const spineIds = Array.from(opf.matchAll(/<itemref\b[^>]*>/giu))
    .map((match) => attributesOf(match[0]))
    .filter((attributes) => attributes.linear?.toLowerCase() !== "no")
    .map((attributes) => attributes.idref)
    .filter((id): id is string => Boolean(id));
  const orderedItems = (spineIds.length ? spineIds.map((id) => byId.get(id)) : manifest)
    .filter((item): item is ManifestItem => Boolean(item))
    .filter(
      (item) =>
        !item.properties.has("nav") &&
        (item.mediaType === "application/xhtml+xml" || /\.(?:xhtml?|html?)$/iu.test(item.path))
    );
  if (!orderedItems.length) {
    throw new Error("EPUB 的阅读顺序中没有可导入的正文。");
  }

  const labels = readNavigationLabels(archive, lookup, opfPath, manifest);
  const warnings: string[] = [];
  const chapters: EpubImportChapter[] = [];
  for (const item of orderedItems) {
    if (FRONT_MATTER_PATH.test(`${item.id}/${item.path}`)) {
      continue;
    }
    const html = readArchiveText(archive, lookup, item.path);
    if (!html) {
      warnings.push(`跳过缺失的正文文件：${item.path}`);
      continue;
    }
    const sections = splitHtmlSections(html);
    const navigationTitle = labels.get(item.path);
    const documentTitle = titleFromDocument(html, item.path);
    sections.forEach((section, index) => {
      const body = xhtmlToMarkdown(section.html);
      const title = (
        section.title ||
        (index === 0 ? navigationTitle : "") ||
        documentTitle ||
        `第 ${chapters.length + 1} 章`
      ).trim();
      if (SKIPPABLE_PAGE_TITLE.test(title)) {
        return;
      }
      if (!body && sections.length > 1) {
        return;
      }
      if (!body) {
        warnings.push(`跳过空页面：${title}`);
        return;
      }
      chapters.push({ title, body, sourcePath: item.path });
    });
  }

  if (!chapters.length) {
    throw new Error("EPUB 中没有识别到可导入的正文章节。");
  }

  return {
    title: firstElementText(opf, "title") || "导入的 EPUB",
    author: firstElementText(opf, "creator"),
    language: firstElementText(opf, "language") || "zh-CN",
    chapters,
    warnings
  };
};
