const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

export const stripLegacyChapterHeading = (content: string, chapterTitle: string): string => {
  const title = chapterTitle.trim();
  if (!title) {
    return content;
  }

  const heading = new RegExp(`^\\s*#\\s+${escapeRegExp(title)}\\s*(?:\\r?\\n)+(?:\\r?\\n)*`, "u");
  return content.replace(heading, "");
};
