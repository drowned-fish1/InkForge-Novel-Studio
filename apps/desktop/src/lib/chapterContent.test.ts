import { describe, expect, it } from "vitest";
import { listMarkdownHeadings, stripLegacyChapterHeading } from "./chapterContent";

describe("stripLegacyChapterHeading", () => {
  it("removes a stored heading that duplicates the chapter title", () => {
    expect(stripLegacyChapterHeading("# 第1章 风起之时\n\n正文第一段", "第1章 风起之时")).toBe("正文第一段");
  });

  it("keeps an intentional heading with a different title", () => {
    expect(stripLegacyChapterHeading("# 场景一\n\n正文", "第1章 风起之时")).toBe("# 场景一\n\n正文");
  });
});

describe("listMarkdownHeadings", () => {
  it("returns headings with level, text, offset and line", () => {
    const content = "开场段落\n\n## 场景一\n\n正文\n\n### 转折点\n结尾";
    expect(listMarkdownHeadings(content)).toEqual([
      { level: 2, text: "场景一", offset: 6, line: 3 },
      { level: 3, text: "转折点", offset: 18, line: 7 }
    ]);
  });

  it("ignores headings inside fenced code blocks and non-heading hashes", () => {
    const content = "```\n# 注释\n```\n\n# 真标题\n\n#无空格不算标题";
    const headings = listMarkdownHeadings(content);
    expect(headings).toHaveLength(1);
    expect(headings[0]).toMatchObject({ level: 1, text: "真标题" });
  });

  it("strips trailing closing hashes and keeps indentation offsets accurate", () => {
    const content = "  ## 缩进标题 ##";
    const [heading] = listMarkdownHeadings(content);
    expect(heading.text).toBe("缩进标题");
    expect(heading.offset).toBe(2);
    expect(content.slice(heading.offset).startsWith("## 缩进标题")).toBe(true);
  });

  it("returns an empty list for content without headings", () => {
    expect(listMarkdownHeadings("只有正文\n没有标题")).toEqual([]);
  });
});
