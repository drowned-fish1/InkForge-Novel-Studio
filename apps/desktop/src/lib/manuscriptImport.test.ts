import { describe, expect, it, vi } from "vitest";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { decodeManuscript, parseDocxManuscript, splitManuscript } from "./manuscriptImport";

// Vite selects Mammoth's browser ZIP reader. Vitest runs in Node, whose
// ZIP reader takes a Buffer; keep the real converter and adapt only input.
vi.mock("mammoth", async (importOriginal) => {
  const { default: mammoth } = await importOriginal<typeof import("mammoth") & { default: typeof import("mammoth") }>();
  return {
    default: {
      ...mammoth,
      convertToHtml: (input: { arrayBuffer: ArrayBuffer }, options: Parameters<typeof mammoth.convertToHtml>[1]) =>
        mammoth.convertToHtml({ buffer: Buffer.from(input.arrayBuffer) }, options)
    }
  };
});

describe("legacy manuscript migration", () => {
  it("decodes UTF-8, BOM UTF-16 and a legacy GBK novel without replacement characters", () => {
    expect(decodeManuscript(new TextEncoder().encode("第一章 潮汐"))).toEqual({
      text: "第一章 潮汐",
      encoding: "utf-8"
    });
    expect(decodeManuscript(new Uint8Array([0xff, 0xfe, 0x00, 0x4e, 0xa0, 0x98]))).toEqual({
      text: "一颠",
      encoding: "utf-16le"
    });
    expect(decodeManuscript(new Uint8Array([0xb5, 0xda, 0xd2, 0xbb, 0xd5, 0xc2]))).toEqual({
      text: "第一章",
      encoding: "gb18030"
    });
    expect(() => decodeManuscript(new Uint8Array([0xff]), "utf-8")).toThrow();
  });

  it("retains prefaces and volume boundaries while removing chapter headings from the body", () => {
    const chapters = splitManuscript({
      name: "旧稿.txt",
      text: "前言正文\r\n第一卷 潮起\r\n第一章 起点\r\n正文一\r\n第二章 风暴\r\n正文二\r\n第二卷 风落\r\n第三章 归途\r\n正文三"
    });
    expect(chapters).toEqual([
      { title: "旧稿", body: "前言正文" },
      { title: "第一章 起点", body: "正文一", volumeTitle: "第一卷 潮起" },
      { title: "第二章 风暴", body: "正文二", volumeTitle: "第一卷 潮起" },
      { title: "第三章 归途", body: "正文三", volumeTitle: "第二卷 风落" }
    ]);
  });

  it("prefers explicit chapters over book titles and keeps scene headings and fenced examples", () => {
    const chapters = splitManuscript({
      name: "book.md",
      text: "# 小说\n前言\n## Chapter 1: Arrival\n正文\n### Scene one\n场景正文\n```md\n# 示例标题\nChapter 99\n```\n## Chapter 2\n结尾"
    });
    expect(chapters.map((chapter) => chapter.title)).toEqual(["book", "Chapter 1: Arrival", "Chapter 2"]);
    expect(chapters[1].body).toContain("### Scene one");
    expect(chapters[1].body).toContain("Chapter 99");
    expect(chapters[0].body).toContain("# 小说");
  });

  it("supports explicit heading levels and a lossless whole-file fallback", () => {
    const source = { name: "book.md", text: "# 小说\n## 相遇\n正文\n### 余波\n场景\n## 离别\n结尾" };
    expect(splitManuscript(source, "h2").map((chapter) => chapter.title)).toEqual(["book", "相遇", "离别"]);
    expect(splitManuscript(source, "file")).toEqual([{ title: "book", body: source.text }]);
    expect(splitManuscript({ name: "empty.txt", text: "  " })).toEqual([]);
  });

  it("uses Mammoth to convert a real Word file with styled headings and emphasis", async () => {
    const bytes = await Packer.toBuffer(
      new Document({
        sections: [
          {
            children: [
              new Paragraph({ text: "第一卷 潮起", heading: HeadingLevel.HEADING_1 }),
              new Paragraph({ text: "第一章 起点", heading: HeadingLevel.HEADING_2 }),
              new Paragraph({
                children: [new TextRun("林舟走进港口，"), new TextRun({ text: "决定出航", bold: true })]
              }),
              new Paragraph({ text: "第二章 远海", heading: HeadingLevel.HEADING_2 }),
              new Paragraph("风从海面升起。")
            ]
          }
        ]
      })
    );
    const source = await parseDocxManuscript("旧稿.docx", bytes);
    const chapters = splitManuscript(source);
    expect(chapters.map((chapter) => chapter.title)).toEqual(["第一章 起点", "第二章 远海"]);
    expect(chapters[0].volumeTitle).toBe("第一卷 潮起");
    expect(chapters[0].body).toBe("林舟走进港口，**决定出航**");
    expect(source.text).not.toContain("<p>");
  });

  it("rejects invalid DOCX archives before calling the document converter", async () => {
    await expect(parseDocxManuscript("fake.docx", new TextEncoder().encode("not a zip"))).rejects.toThrow();
  });
});
