import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { parseEpub, xhtmlToMarkdown } from "./epubImport";

const epubBytes = (entries: Record<string, string>): Uint8Array =>
  zipSync(Object.fromEntries(Object.entries(entries).map(([path, value]) => [path, strToU8(value)])));

const containerXml = `<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles><rootfile media-type="application/oebps-package+xml" full-path="OPS/package.opf" /></rootfiles>
</container>`;

describe("EPUB import", () => {
  it("reads metadata, follows spine order and uses EPUB 3 navigation labels", () => {
    const bytes = epubBytes({
      mimetype: "application/epub+zip",
      "META-INF/container.xml": containerXml,
      "OPS/package.opf": `<?xml version="1.0"?>
        <package xmlns="http://www.idpf.org/2007/opf" version="3.0">
          <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
            <dc:title>远海之书</dc:title><dc:creator>林舟</dc:creator><dc:language>zh-CN</dc:language>
          </metadata>
          <manifest>
            <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
            <item id="cover" href="text/cover.xhtml" media-type="application/xhtml+xml" />
            <item id="second" href="text/chapter-2.xhtml" media-type="application/xhtml+xml" />
            <item id="first" href="text/chapter-1.xhtml" media-type="application/xhtml+xml" />
          </manifest>
          <spine><itemref idref="cover" /><itemref idref="first" /><itemref idref="second" /></spine>
        </package>`,
      "OPS/nav.xhtml": `<html><body><nav epub:type="toc"><ol>
        <li><a href="text/chapter-1.xhtml#start">潮汐初醒</a></li>
        <li><a href="text/chapter-2.xhtml">风暴将至</a></li>
      </ol></nav></body></html>`,
      "OPS/text/cover.xhtml": `<html><head><title>Cover</title></head><body><img src="cover.jpg" /></body></html>`,
      "OPS/text/chapter-1.xhtml": `<html><head><title>Fallback One</title></head><body>
        <p>第一段 &amp; 线索。</p><p><strong>重要</strong>，继续前进。</p>
        <script>alert("bad")</script><img src="map.png" alt="群岛地图" />
      </body></html>`,
      "OPS/text/chapter-2.xhtml": `<html><head><title>Fallback Two</title></head><body>
        <p>风从海面升起。</p><ul><li>收帆</li><li>转舵</li></ul>
      </body></html>`
    });

    const result = parseEpub(bytes);

    expect(result.title).toBe("远海之书");
    expect(result.author).toBe("林舟");
    expect(result.language).toBe("zh-CN");
    expect(result.chapters.map((chapter) => chapter.title)).toEqual(["潮汐初醒", "风暴将至"]);
    expect(result.chapters[0].body).toContain("第一段 & 线索。");
    expect(result.chapters[0].body).toContain("**重要**");
    expect(result.chapters[0].body).toContain("【插图：群岛地图】");
    expect(result.chapters[0].body).not.toContain("alert");
    expect(result.chapters[1].body).toContain("- 收帆");
  });

  it("supports EPUB 2 NCX labels and splits a single spine document by chapter headings", () => {
    const bytes = epubBytes({
      "META-INF/container.xml": containerXml,
      "OPS/package.opf": `<package version="2.0"><metadata><title>合集</title></metadata><manifest>
        <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml" />
        <item id="book" href="Text/book.xhtml" media-type="application/xhtml+xml" />
      </manifest><spine toc="ncx"><itemref idref="book" /></spine></package>`,
      "OPS/toc.ncx": `<ncx><navMap><navPoint><navLabel><text>整本书</text></navLabel><content src="Text/book.xhtml" /></navPoint></navMap></ncx>`,
      "OPS/Text/book.xhtml": `<html><body>
        <h1>第一章 登船</h1><p>港口仍在沉睡。</p>
        <h1>第二章 启航</h1><p>船帆接住晨风。</p>
      </body></html>`
    });

    const result = parseEpub(bytes);

    expect(result.chapters.map((chapter) => chapter.title)).toEqual(["第一章 登船", "第二章 启航"]);
    expect(result.chapters.map((chapter) => chapter.body)).toEqual(["港口仍在沉睡。", "船帆接住晨风。"]);
  });

  it("converts safe rich text while dropping local links and executable markup", () => {
    const markdown = xhtmlToMarkdown(`<body>
      <p><a href="https://example.com">站点</a> / <a href="../notes.xhtml">注释</a></p>
      <blockquote>潮水正在上涨</blockquote><pre>&lt;safe&gt;</pre><iframe src="bad"></iframe>
    </body>`);

    expect(markdown).toContain("[站点](https://example.com)");
    expect(markdown).toContain("注释");
    expect(markdown).not.toContain("../notes.xhtml");
    expect(markdown).toContain("> 潮水正在上涨");
    expect(markdown).toContain("```\n<safe>\n```");
    expect(markdown).not.toContain("iframe");
  });

  it("reports damaged or structurally incomplete EPUB files", () => {
    expect(() => parseEpub(strToU8("not a zip"))).toThrow("EPUB 压缩包损坏");
    expect(() => parseEpub(epubBytes({ "META-INF/container.xml": "<container />" }))).toThrow("EPUB 缺少 OPF 内容清单");
  });
});
