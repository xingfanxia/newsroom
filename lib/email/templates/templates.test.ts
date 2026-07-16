import { describe, expect, test } from "bun:test";
import { renderDailyDigestEmail } from "@/lib/email/templates/daily-digest";
import { renderDailyFeaturedEmail } from "@/lib/email/templates/daily-featured";
import { renderConfirmEmail } from "@/lib/email/templates/confirm";

const UNSUB = "https://news.ax0x.ai/api/newsletter/unsubscribe?token=__T__";

function digestInput(overrides: Record<string, unknown> = {}) {
  return {
    title: "Google 四百亿与静悄悄的 5.5",
    themeTag: "算力订座战",
    dateKey: "2026-07-16",
    summaryMd: "今天聊 **三件事**: 投资、发布、流程改造。",
    narrativeMd:
      "## Google 四百亿不是一张支票\n\n投资最高 **400 亿美元**, 细节见 [#1234]。\n\n> 官方说法引用一句。\n\n## 今日小信号\n\n- 第一条小信号\n- 第二条小信号",
    featured: [
      {
        id: 1234,
        title: "Google 拟投 Anthropic 400 亿",
        url: "https://example.com/google-anthropic",
      },
    ],
    itemUrlById: new Map([[1234, "https://example.com/google-anthropic"]]),
    unsubscribeUrl: UNSUB,
    ...overrides,
  };
}

function story(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    title: "OpenAI 把 5.5 静悄悄接进 API",
    url: "https://example.com/openai-55",
    sourceName: "The Verge",
    tier: "featured",
    importance: 92,
    summary: "没有发布会, 没有博客, 模型直接出现在 API 列表里。",
    analysis: "定价都没说, 这次发布更像一次压力测试。",
    ...overrides,
  };
}

describe("renderDailyDigestEmail", () => {
  test("subject is 【AX 日报】+ title", () => {
    const email = renderDailyDigestEmail(digestInput());
    expect(email.subject).toBe("【AX 日报】Google 四百亿与静悄悄的 5.5");
  });

  test("html carries theme tag, date, web version link, unsubscribe link", () => {
    const email = renderDailyDigestEmail(digestInput());
    expect(email.html).toContain("算力订座战");
    expect(email.html).toContain("2026-07-16");
    expect(email.html).toContain("https://news.ax0x.ai/zh/daily/2026-07-16");
    expect(email.html).toContain(UNSUB);
  });

  test("narrative renders sections and resolves [#NNNN] to external urls only", () => {
    const email = renderDailyDigestEmail(digestInput());
    expect(email.html).toContain("<h2");
    expect(email.html).toContain("Google 四百亿不是一张支票");
    expect(email.html).toContain('href="https://example.com/google-anthropic"');
    expect(email.html).not.toContain("/zh/items/");
    expect(email.html).toContain("<blockquote");
    expect(email.html).toContain("<ul");
  });

  test("featured callout lists items with external links", () => {
    const email = renderDailyDigestEmail(digestInput());
    expect(email.html).toContain("Google 拟投 Anthropic 400 亿");
  });

  test("text part is non-empty and holds the title and unsubscribe url", () => {
    const email = renderDailyDigestEmail(digestInput());
    expect(email.text.length).toBeGreaterThan(50);
    expect(email.text).toContain("Google 四百亿与静悄悄的 5.5");
    expect(email.text).toContain(UNSUB);
  });

  test("escapes hostile content in title and narrative", () => {
    const email = renderDailyDigestEmail(
      digestInput({
        title: '<script>alert(1)</script>',
        narrativeMd: '正文 <img src=x onerror=alert(2)> 内容',
      }),
    );
    expect(email.html).not.toContain("<script>");
    expect(email.html).not.toContain("<img src=x");
  });

  test("non-http(s) featured item url renders the title unlinked", () => {
    const email = renderDailyDigestEmail(
      digestInput({
        featured: [
          { id: 1, title: "危险条目", url: "javascript:alert(1)" },
        ],
      }),
    );
    expect(email.html).not.toContain("javascript:");
    expect(email.html).toContain("危险条目");
  });

  test("subject strips control characters and newlines", () => {
    const email = renderDailyDigestEmail(
      digestInput({ title: "标题\r\nBcc: evil@example.com" }),
    );
    expect(email.subject).not.toContain("\n");
    expect(email.subject).not.toContain("\r");
  });

  test("stays under the 90KB Gmail-clip budget at max plausible content", () => {
    const section =
      "## 一个足够长的小节标题在这里\n\n" +
      `${"这是一句凑长度的正文, 带一点 **加粗** 和判断。".repeat(30)}\n\n> 引用一句话在这里。\n\n`;
    const email = renderDailyDigestEmail(
      digestInput({ narrativeMd: section.repeat(8) }),
    );
    expect(Buffer.byteLength(email.html, "utf8")).toBeLessThan(90 * 1024);
  });
});

describe("renderDailyFeaturedEmail", () => {
  test("subject is 【AX 精选】top title 等 N 条 for N>1", () => {
    const email = renderDailyFeaturedEmail({
      dateKey: "2026-07-16",
      stories: [story(), story({ id: 43, title: "第二条", url: "https://example.com/2" })],
      unsubscribeUrl: UNSUB,
    });
    expect(email.subject).toBe("【AX 精选】OpenAI 把 5.5 静悄悄接进 API 等 2 条");
  });

  test("subject drops 等 N 条 for a single story", () => {
    const email = renderDailyFeaturedEmail({
      dateKey: "2026-07-16",
      stories: [story()],
      unsubscribeUrl: UNSUB,
    });
    expect(email.subject).toBe("【AX 精选】OpenAI 把 5.5 静悄悄接进 API");
  });

  test("each story block has external link, meta line, and 锐评 blockquote", () => {
    const email = renderDailyFeaturedEmail({
      dateKey: "2026-07-16",
      stories: [story()],
      unsubscribeUrl: UNSUB,
    });
    expect(email.html).toContain('href="https://example.com/openai-55"');
    expect(email.html).toContain("The Verge");
    expect(email.html).toContain("92");
    expect(email.html).toContain("定价都没说");
    expect(email.html).toContain(UNSUB);
    expect(email.html).not.toContain("/zh/items/");
    expect(email.text).toContain("OpenAI 把 5.5 静悄悄接进 API");
  });

  test("non-http(s) story url renders the title unlinked", () => {
    const email = renderDailyFeaturedEmail({
      dateKey: "2026-07-16",
      stories: [story({ url: "javascript:alert(document.cookie)" })],
      unsubscribeUrl: UNSUB,
    });
    expect(email.html).not.toContain("javascript:");
    expect(email.html).toContain("OpenAI 把 5.5 静悄悄接进 API");
  });

  test("escapes hostile story fields", () => {
    const email = renderDailyFeaturedEmail({
      dateKey: "2026-07-16",
      stories: [
        story({
          title: "<script>alert(1)</script>",
          analysis: '<img src=x onerror=alert(2)>',
        }),
      ],
      unsubscribeUrl: UNSUB,
    });
    expect(email.html).not.toContain("<script>");
    expect(email.html).not.toContain("<img src=x");
  });
});

describe("renderConfirmEmail", () => {
  test("carries the confirm url in both html and text", () => {
    const email = renderConfirmEmail({
      confirmUrl: "https://news.ax0x.ai/api/newsletter/confirm?token=abc",
    });
    expect(email.subject).toContain("确认");
    expect(email.html).toContain(
      "https://news.ax0x.ai/api/newsletter/confirm?token=abc",
    );
    expect(email.text).toContain(
      "https://news.ax0x.ai/api/newsletter/confirm?token=abc",
    );
  });
});
