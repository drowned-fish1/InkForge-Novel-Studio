import { strFromU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { EpubExportConfigSchema, runExportPreflight } from "@inkforge/schemas";
import {
  buildEpubArchive,
  findXmlWellFormednessError,
  renderMarkdownAsXhtml,
  validateEpubArchive
} from "./ExportService.js";

// Minimal valid 1x1 PNG.
const pngBytes = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="),
  (char) => char.charCodeAt(0)
);

const buildInput = (overrides: Partial<Parameters<typeof buildEpubArchive>[0]> = {}) => ({
  identifier: "urn:inkforge:test-book",
  config: EpubExportConfigSchema.parse({
    title: "测试 & 样书",
    author: "作者甲",
    publisher: "InkForge",
    copyright: "© 2026 作者甲",
    volumeTitlePages: true
  }),
  fallbackTitle: "回退书名",
  fallbackAuthor: "回退作者",
  fallbackDescription: "回退简介",
  volumes: [
    {
      title: "第一卷",
      chapters: [
        { title: "第1章 雨夜", body: "他推开门，**雨水** 顺着屋檐落下。\n\n第二段。" },
        { title: "第2章 追踪", body: "巷子尽头的灯忽明忽暗。" }
      ]
    },
    {
      title: "第二卷",
      chapters: [{ title: "第3章 转折", body: "灯灭了。" }]
    }
  ],
  cover: { data: pngBytes, mediaType: "image/png" as const },
  modifiedAt: "2026-07-27T00:00:00.000Z",
  ...overrides
});

describe("buildEpubArchive", () => {
  it("produces a structurally valid EPUB with cover, copyright and nested TOC", () => {
    const archive = buildEpubArchive(buildInput());
    expect(validateEpubArchive(archive)).toEqual([]);

    const files = unzipSync(archive);
    expect(strFromU8(files.mimetype)).toBe("application/epub+zip");
    expect(files["OEBPS/images/cover.png"]).toBeDefined();
    expect(files["OEBPS/toc.ncx"]).toBeDefined();

    const opf = strFromU8(files["OEBPS/content.opf"]);
    expect(opf).toContain('properties="cover-image"');
    expect(opf).toContain("<dc:rights>© 2026 作者甲</dc:rights>");
    expect(opf).toContain("<dc:publisher>InkForge</dc:publisher>");
    expect(opf).toContain("测试 &amp; 样书");
    expect(opf).toContain('<spine toc="ncx">');

    const nav = strFromU8(files["OEBPS/nav.xhtml"]);
    // Volume entries nest their chapters in a sub-list.
    expect(nav).toContain("第一卷");
    expect(nav.indexOf("<ol>")).toBeLessThan(nav.indexOf("第1章 雨夜"));
    expect(nav).toContain('epub:type="landmarks"');

    const chapter = strFromU8(files["OEBPS/text/v1-c1.xhtml"]);
    expect(chapter).toContain("<strong>雨水</strong>");
    expect(files["OEBPS/text/copyright.xhtml"]).toBeDefined();
    expect(files["OEBPS/text/volume-2.xhtml"]).toBeDefined();
  });

  it("uses fallback metadata and per-volume numbering when fields are empty", () => {
    const archive = buildEpubArchive(
      buildInput({
        config: EpubExportConfigSchema.parse({}),
        cover: undefined,
        volumes: [
          { title: "", chapters: [{ title: undefined, body: "正文一" }] },
          { title: "", chapters: [{ title: undefined, body: "正文二" }] }
        ]
      })
    );
    expect(validateEpubArchive(archive)).toEqual([]);
    const files = unzipSync(archive);
    const nav = strFromU8(files["OEBPS/nav.xhtml"]);
    expect(nav).toContain("第 1 卷");
    expect(nav).toContain("第 1 章");
    const opf = strFromU8(files["OEBPS/content.opf"]);
    expect(opf).toContain("回退书名");
    expect(opf).not.toContain("cover-image");
  });
});

describe("validateEpubArchive / findXmlWellFormednessError", () => {
  it("flags malformed XHTML", () => {
    expect(findXmlWellFormednessError("<html><body><p>ok</p></body></html>")).toBeUndefined();
    expect(findXmlWellFormednessError("<html><body><p>bad</body></html>")).toContain("闭合不匹配");
    expect(findXmlWellFormednessError("<html><body>a & b</body></html>")).toContain("未转义");
    expect(findXmlWellFormednessError("<p>自闭合<br/>合法</p>")).toBeUndefined();
  });

  it("reports missing manifest targets", () => {
    const archive = buildEpubArchive(buildInput());
    const files = unzipSync(archive);
    delete files["OEBPS/text/v1-c2.xhtml"];
    const broken = zipSync(files);
    const problems = validateEpubArchive(broken);
    expect(problems.join(" ")).toContain("v1-c2.xhtml");
  });
});

describe("renderMarkdownAsXhtml", () => {
  it("escapes raw html, keeps http links and drops relative links", () => {
    const output = renderMarkdownAsXhtml("<b>raw</b> [好](https://a.example) [坏](../local.md) ![图](img.png)");
    expect(output).toContain("&lt;b&gt;raw&lt;/b&gt;");
    expect(output).toContain('href="https://a.example"');
    expect(output).not.toContain("local.md");
    expect(output).toContain('class="image-alt"');
    expect(findXmlWellFormednessError(`<body>${output}</body>`)).toBeUndefined();
  });
});

describe("runExportPreflight", () => {
  it("detects empty chapters, duplicate titles, invalid links and image refs", () => {
    const issues = runExportPreflight({
      volumes: [
        {
          title: "第一卷",
          chapters: [
            { id: "c1", title: "同名", content: "" },
            {
              id: "c2",
              title: "同名",
              content: "这是一个足够长的正文段落，超过二十个字符没问题。[内](./x.md) ![封](a.png)"
            }
          ]
        }
      ],
      epub: { title: "", author: "", coverImagePath: "missing.png" },
      coverExists: false
    });
    const kinds = issues.map((issue) => issue.kind);
    expect(kinds).toContain("empty-chapter");
    expect(kinds).toContain("duplicate-title");
    expect(kinds).toContain("invalid-link");
    expect(kinds).toContain("missing-resource");
    expect(issues.find((issue) => issue.id === "cover-missing")?.severity).toBe("error");
    expect(kinds.filter((kind) => kind === "metadata")).toHaveLength(2);
  });
});
