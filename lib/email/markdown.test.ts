import { describe, expect, test } from "bun:test";
import { renderEmailMarkdown, renderEmailText } from "@/lib/email/markdown";

const ITEM_URLS = new Map<number, string>([
  [1234, "https://example.com/story"],
]);

describe("renderEmailMarkdown", () => {
  test("renders ## sections as styled h2", () => {
    const html = renderEmailMarkdown("## Google 四百亿不是一张支票");
    expect(html).toContain("<h2");
    expect(html).toContain("Google 四百亿不是一张支票");
    expect(html).not.toContain("##");
  });

  test("renders paragraphs split on blank lines, single newline becomes <br>", () => {
    const html = renderEmailMarkdown("第一段第一句。\n第一段第二句。\n\n第二段。");
    const paragraphs = html.match(/<p[^>]*>/g) ?? [];
    expect(paragraphs).toHaveLength(2);
    expect(html).toContain("<br");
  });

  test("renders **bold** and *em*", () => {
    const html = renderEmailMarkdown("投资最高 **400 亿美元**, 有点 *意思*");
    expect(html).toContain("<strong");
    expect(html).toContain("400 亿美元");
    expect(html).toContain("<em");
    expect(html).not.toContain("**");
  });

  test("renders consecutive > lines as one blockquote", () => {
    const html = renderEmailMarkdown("> 第一行引用\n> 第二行引用");
    const quotes = html.match(/<blockquote/g) ?? [];
    expect(quotes).toHaveLength(1);
    expect(html).toContain("第一行引用");
    expect(html).toContain("第二行引用");
  });

  test("renders - lists and 1. lists", () => {
    const ul = renderEmailMarkdown("- 第一条\n- 第二条");
    expect(ul).toContain("<ul");
    expect((ul.match(/<li/g) ?? []).length).toBe(2);
    const ol = renderEmailMarkdown("1. 第一条\n2. 第二条");
    expect(ol).toContain("<ol");
    expect((ol.match(/<li/g) ?? []).length).toBe(2);
  });

  test("[#NNNN] resolves to the item's external URL, never /zh/items/", () => {
    const html = renderEmailMarkdown("细节见 [#1234] 这条", {
      itemUrlById: ITEM_URLS,
    });
    expect(html).toContain('href="https://example.com/story"');
    expect(html).toContain("#1234");
    expect(html).not.toContain("/zh/items/");
  });

  test("unresolvable [#NNNN] strips to plain text", () => {
    const html = renderEmailMarkdown("细节见 [#9999] 这条", {
      itemUrlById: ITEM_URLS,
    });
    expect(html).not.toContain("<a");
    expect(html).toContain("#9999");
  });

  test("markdown links pass through only for http(s) hrefs", () => {
    const ok = renderEmailMarkdown("[官方公告](https://openai.com/blog)");
    expect(ok).toContain('href="https://openai.com/blog"');
    expect(ok).toContain("官方公告");
    const bad = renderEmailMarkdown("[点我](javascript:alert(1))");
    expect(bad).not.toContain("<a");
    expect(bad).not.toContain("javascript:");
    expect(bad).toContain("点我");
  });

  test("escapes HTML in all content — script and onerror fixtures", () => {
    const html = renderEmailMarkdown(
      '## <script>alert(1)</script>\n\n正文 <img src=x onerror=alert(2)> 内容 & "引号"',
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img");
    expect(html).toContain("&amp;");
  });

  test("escapes HTML inside link text and bold", () => {
    const html = renderEmailMarkdown(
      "**<b>粗</b>** [<i>斜</i>](https://example.com)",
    );
    expect(html).not.toContain("<b>");
    expect(html).not.toContain("<i>");
  });

  test("cross-markup: [[#N]](url) never nests anchors", () => {
    const html = renderEmailMarkdown("[[#1234]](https://evil.example.com)", {
      itemUrlById: ITEM_URLS,
    });
    expect(html).not.toMatch(/<a[^>]*>[^<]*<a/);
    // The resolved ref link survives; the outer wrapper degrades.
    expect(html).toContain('href="https://example.com/story"');
    expect(html).not.toContain("evil.example.com");
    expect(html).not.toContain("\u0000");
  });

  test("cross-markup: a link URL containing [#N] degrades without broken markup", () => {
    const html = renderEmailMarkdown("[click](https://x.example.com/[#1234])", {
      itemUrlById: ITEM_URLS,
    });
    expect(html).not.toMatch(/<a[^>]*>[^<]*<a/);
    expect(html).not.toContain("\u0000");
  });

  test("bold wrapping a ref keeps both layers intact", () => {
    const html = renderEmailMarkdown("**重点 [#1234]**", {
      itemUrlById: ITEM_URLS,
    });
    expect(html).toContain("<strong");
    expect(html).toContain('href="https://example.com/story"');
    expect(html).not.toContain("\u0000");
  });
});

describe("renderEmailText", () => {
  test("strips markup, keeps content and structure", () => {
    const text = renderEmailText(
      "## 标题\n\n正文 **重点** 和 [#1234] 引用\n\n> 引用一句\n\n- 列表项",
    );
    expect(text).toContain("标题");
    expect(text).toContain("正文 重点 和 #1234 引用");
    expect(text).toContain("> 引用一句");
    expect(text).toContain("- 列表项");
    expect(text).not.toContain("**");
    expect(text).not.toContain("##");
    expect(text).not.toContain("<");
  });

  test("markdown links become text (url)", () => {
    const text = renderEmailText("[官方公告](https://openai.com/blog)");
    expect(text).toContain("官方公告 (https://openai.com/blog)");
  });
});
