import { describe, expect, it } from "vitest";
import { composeAgentDocumentPrompt, parseTextDocumentContent } from "./textDocument";

describe("Agent text document import", () => {
  it("normalizes plain text line endings and strips a BOM", () => {
    const document = parseTextDocumentContent("world.txt", "\uFEFF第一行\r\n第二行\r");
    expect(document.content).toBe("第一行\n第二行");
    expect(document.characters).toBe(7);
  });

  it("formats JSON so the Agent receives readable structured data", () => {
    const document = parseTextDocumentContent("outline.json", '{"volumes":[{"title":"第一卷"}]}');
    expect(document.content).toContain('\n  "volumes":');
    expect(document.content).toContain('"第一卷"');
  });

  it("rejects unsupported or binary documents", () => {
    expect(() => parseTextDocumentContent("novel.docx", "binary")).toThrow("暂不支持");
    expect(() => parseTextDocumentContent("novel.txt", "a\u0000b")).toThrow("二进制");
  });

  it("combines instructions and imported documents into one model prompt", () => {
    const document = parseTextDocumentContent("world.md", "# 世界观\n边城夜间宵禁。");
    const prompt = composeAgentDocumentPrompt("整理世界观", [document]);
    expect(prompt).toContain("整理世界观");
    expect(prompt).toContain("【文档开始：world.md");
    expect(prompt).toContain("边城夜间宵禁");
  });
});
