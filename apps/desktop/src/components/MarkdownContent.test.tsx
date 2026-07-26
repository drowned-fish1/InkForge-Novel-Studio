import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownContent } from "./MarkdownContent";

describe("MarkdownContent", () => {
  it("renders common markdown as structured markup", () => {
    const html = renderToStaticMarkup(<MarkdownContent content={"**重点**\n\n- 第一项\n- 第二项\n\n`code`"} />);

    expect(html).toContain("<strong>重点</strong>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<code>code</code>");
    expect(html).not.toContain("***");
  });

  it("does not execute raw html or unsafe links", () => {
    const html = renderToStaticMarkup(
      <MarkdownContent content={'<script>alert("x")</script>\n\n[危险链接](javascript:alert(1))'} />
    );

    expect(html).not.toContain("<script>");
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain("&lt;script&gt;");
  });
});
