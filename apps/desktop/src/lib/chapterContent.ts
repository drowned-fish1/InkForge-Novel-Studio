const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

export const stripLegacyChapterHeading = (content: string, chapterTitle: string): string => {
  const title = chapterTitle.trim();
  if (!title) {
    return content;
  }

  const heading = new RegExp(`^\\s*#\\s+${escapeRegExp(title)}\\s*(?:\\r?\\n)+(?:\\r?\\n)*`, "u");
  return content.replace(heading, "");
};

export interface MarkdownHeading {
  level: number;
  text: string;
  offset: number;
  line: number;
}

export const listMarkdownHeadings = (content: string): MarkdownHeading[] => {
  const headings: MarkdownHeading[] = [];
  let offset = 0;
  let line = 1;
  let inFence = false;
  for (const rawLine of content.split("\n")) {
    const trimmed = rawLine.trimStart();
    if (/^(?:```|~~~)/u.test(trimmed)) {
      inFence = !inFence;
    } else if (!inFence) {
      const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/u.exec(trimmed);
      if (match) {
        headings.push({
          level: match[1].length,
          text: match[2],
          offset: offset + (rawLine.length - trimmed.length),
          line
        });
      }
    }
    offset += rawLine.length + 1;
    line += 1;
  }
  return headings;
};
