import { describe, expect, it } from "vitest";
import { stripLegacyChapterHeading } from "./chapterContent";

describe("stripLegacyChapterHeading", () => {
  it("removes a stored heading that duplicates the chapter title", () => {
    expect(stripLegacyChapterHeading("# 第1章 风起之时\n\n正文第一段", "第1章 风起之时")).toBe("正文第一段");
  });

  it("keeps an intentional heading with a different title", () => {
    expect(stripLegacyChapterHeading("# 场景一\n\n正文", "第1章 风起之时")).toBe("# 场景一\n\n正文");
  });
});
