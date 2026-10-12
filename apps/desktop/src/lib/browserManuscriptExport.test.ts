import { beforeEach, describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { buildBrowserEpub, renderBrowserEpubMarkdown } from "./browserManuscriptExport";
import { parseEpub } from "./epubImport";

const storage = new Map<string, string>();

beforeEach(() => {
  storage.clear();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear()
    }
  });
  const now = "2026-08-12T10:00:00+08:00";
  const chapter = (id: string, number: number, title: string, file: string) => ({
    id,
    number,
    title,
    file,
    goal: "",
    hook: "",
    status: "done",
    targetWords: 3000,
    actualWords: 100,
    archived: false,
    notes: "",
    conflictPoints: "",
    characters: [],
    worldRefs: []
  });
  const record = {
    summary: {
      projectPath: "browser:test",
      meta: {
        schemaVersion: "0.1.0",
        projectId: "project-browser-epub",
        title: "Browser Novel",
        author: "Test Author",
        genre: [],
        targetWords: 10000,
        createdAt: now,
        updatedAt: now,
        defaultProviderId: "openai-compatible",
        defaultModel: "test",
        writingPreferences: { pov: "third", style: "plain", chapterWords: 3000 }
      },
      outline: {
        schemaVersion: "0.1.0",
        premise: "",
        mainConflict: "",
        endingDirection: "",
        volumes: [
          {
            id: "v1",
            title: "Volume One",
            goal: "",
            targetWords: 5000,
            chapters: [chapter("c1", 1, "Opening", "chapters/c1.md")]
          },
          {
            id: "v2",
            title: "Volume Two",
            goal: "",
            targetWords: 5000,
            chapters: [chapter("c2", 2, "Return", "chapters/c2.md")]
          }
        ]
      }
    },
    chapterBodies: {
      "chapters/c1.md": "# Opening\n\n**Bold** and [safe](https://example.com).\n\n<script>bad()</script>",
      "chapters/c2.md": "# Return\n\n![diagram](assets/missing.png)\n\n---"
    },
    characters: [],
    worldEntries: [],
    timeline: [],
    clues: [],
    terms: [],
    conflicts: [],
    prompts: {},
    summaries: {},
    planningSessions: [],
    importSnapshots: {},
    updatedAt: now
  };
  storage.set(
    "inkforge.browser.projects.v1",
    JSON.stringify({ activeProjectPath: "browser:test", projects: { "browser:test": record } })
  );
});

describe("browser EPUB fidelity", () => {
  it("renders safe markdown and degrades unavailable images to alt text", () => {
    const html = renderBrowserEpubMarkdown(
      "**Bold** [safe](https://example.com) [local](../note.md) ![diagram](image.png) <script>bad()</script>"
    );
    expect(html).toContain("<strong>Bold</strong>");
    expect(html).toContain('href="https://example.com"');
    expect(html).not.toContain('href="../note.md"');
    expect(html).toContain('<span class="image-alt">diagram</span>');
    expect(html).not.toContain("<script>");
  });

  it("builds EPUB 3 metadata, legacy NCX and a volume-nested table of contents", () => {
    const bytes = buildBrowserEpub(
      {
        projectPath: "browser:test",
        format: "epub",
        includeChapterTitles: true,
        includeVolumeTitles: true,
        epub: {
          title: "Published Browser Novel",
          author: "Test Author",
          language: "en",
          description: "description",
          cssTheme: "modern",
          publisher: "InkForge Press",
          copyright: "Copyright 2026",
          volumeTitlePages: true
        }
      },
      "Browser Novel"
    );
    const archive = unzipSync(bytes);
    expect(strFromU8(archive.mimetype)).toBe("application/epub+zip");
    expect(archive["OEBPS/toc.ncx"]).toBeDefined();
    expect(archive["OEBPS/text/volume-1.xhtml"]).toBeDefined();
    const opf = strFromU8(archive["OEBPS/content.opf"]);
    const nav = strFromU8(archive["OEBPS/nav.xhtml"]);
    const firstChapter = strFromU8(archive["OEBPS/text/v1-c1.xhtml"]);
    expect(opf).toContain("<dc:publisher>InkForge Press</dc:publisher>");
    expect(opf).toContain("<dc:rights>Copyright 2026</dc:rights>");
    expect(nav).toContain("Volume One");
    expect(nav).toContain("Opening");
    expect(firstChapter).toContain("<strong>Bold</strong>");
    expect(firstChapter).not.toContain("<script>");

    const imported = parseEpub(bytes);
    expect(imported.title).toBe("Published Browser Novel");
    expect(imported.author).toBe("Test Author");
    expect(imported.chapters.map((chapter) => chapter.title)).toEqual(["Opening", "Return"]);
    expect(imported.chapters[0].body).toContain("**Bold**");
    expect(imported.chapters[1].body).toContain("diagram");
  });
});
