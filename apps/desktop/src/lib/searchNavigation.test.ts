import { describe, expect, it } from "vitest";
import { findSearchSelection } from "./searchNavigation";

describe("search selection after edits", () => {
  it("anchors the nearest match after headings or preceding text change", () => {
    const content = "车票在这里。\n\n又一张车票。";
    expect(findSearchSelection(content, "车票", 12)).toEqual({ start: 11, end: 13 });
    expect(findSearchSelection(content, "车票", 0)).toEqual({ start: 0, end: 2 });
  });
  it("reports missing results instead of selecting unrelated text", () => {
    expect(findSearchSelection("已修改正文", "车票", 12)).toBeUndefined();
    expect(findSearchSelection("正文", "  ")).toBeUndefined();
  });
});
