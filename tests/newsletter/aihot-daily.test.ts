/**
 * aihot-daily worker tests — covers the pure helpers (utcYmdFromDate,
 * renderAihotDailyForPrompt). DB-backed cache lookup + actual API calls
 * are integration-tested separately; here we verify the shape contracts
 * the column generator depends on.
 */
import { describe, expect, it } from "bun:test";
import {
  utcYmdFromDate,
  renderAihotDailyForPrompt,
  stripPaperFromAihotDaily,
  aihotDailyItemCount,
  pickRicherAihotDaily,
  isThinAihotDaily,
  resolveAihotDaily,
} from "@/workers/newsletter/aihot-daily";
import type { AihotDailyReport } from "@/lib/sources/aihot";

describe("utcYmdFromDate", () => {
  it("formats a Date as YYYY-MM-DD in UTC", () => {
    expect(utcYmdFromDate(new Date("2026-05-08T00:00:00Z"))).toBe("2026-05-08");
    expect(utcYmdFromDate(new Date("2026-05-08T23:59:59Z"))).toBe("2026-05-08");
  });

  it("rolls over at UTC midnight, ignores local timezone", () => {
    // 2026-05-08T23:00:00-08:00 = 2026-05-09T07:00:00Z
    expect(utcYmdFromDate(new Date("2026-05-08T23:00:00-08:00"))).toBe(
      "2026-05-09",
    );
  });

  it("zero-pads month and day", () => {
    expect(utcYmdFromDate(new Date("2026-01-03T12:00:00Z"))).toBe("2026-01-03");
  });
});

describe("renderAihotDailyForPrompt", () => {
  const minimalPayload: AihotDailyReport = {
    date: "2026-05-08",
    generatedAt: "2026-05-08T00:05:00.000Z",
    windowStart: "2026-05-06T00:00:00.000Z",
    windowEnd: "2026-05-07T00:00:00.000Z",
    lead: { title: "Anthropic 发 Opus 4.7", leadParagraph: "今日 AI 圈三大头部厂商集中发布。" },
    sections: [
      {
        label: "模型发布/更新",
        items: [
          {
            title: "Claude Opus 4.7 1M context",
            summary: "Anthropic 正式开放 1M token 给所有 Pro 用户。",
            sourceUrl: "https://www.anthropic.com/news",
            sourceName: "Anthropic Blog",
          },
        ],
      },
      { label: "产品发布/更新", items: [] },
    ],
    flashes: [
      {
        title: "Cursor 1.0 发布",
        sourceName: "Cursor Blog",
        sourceUrl: "https://cursor.sh/blog/v1",
        publishedAt: "2026-05-07T08:00:00.000Z",
      },
    ],
  };

  it("returns empty string for null payload", () => {
    expect(renderAihotDailyForPrompt(null)).toBe("");
  });

  it("renders a payload as a <aihot-daily> block with date attribute", () => {
    const out = renderAihotDailyForPrompt(minimalPayload);
    expect(out).toContain('<aihot-daily date="2026-05-08"');
    expect(out).toContain("</aihot-daily>");
  });

  it("includes lead title + paragraph when present", () => {
    const out = renderAihotDailyForPrompt(minimalPayload);
    expect(out).toContain("Anthropic 发 Opus 4.7");
    expect(out).toContain("今日 AI 圈三大头部厂商集中发布");
  });

  it("renders all section labels even when items is empty", () => {
    const out = renderAihotDailyForPrompt(minimalPayload);
    expect(out).toContain("模型发布/更新");
    expect(out).toContain("产品发布/更新");
  });

  it("includes section item title + sourceName + url + summary", () => {
    const out = renderAihotDailyForPrompt(minimalPayload);
    expect(out).toContain("Claude Opus 4.7 1M context");
    expect(out).toContain("[Anthropic Blog]");
    expect(out).toContain("https://www.anthropic.com/news");
    expect(out).toContain("Anthropic 正式开放 1M token");
  });

  it("includes flashes with source attribution", () => {
    const out = renderAihotDailyForPrompt(minimalPayload);
    expect(out).toContain("Cursor 1.0 发布");
    expect(out).toContain("https://cursor.sh/blog/v1");
  });

  it("renders 'lead: (none)' when lead is null", () => {
    const noLead: AihotDailyReport = { ...minimalPayload, lead: null };
    expect(renderAihotDailyForPrompt(noLead)).toContain("lead: (none)");
  });

  it("renders '(none)' for empty flashes", () => {
    const noFlashes: AihotDailyReport = { ...minimalPayload, flashes: [] };
    const out = renderAihotDailyForPrompt(noFlashes);
    expect(out).toContain("flashes:\n  (none)");
  });

  it("counts section items + flashes for thin-report detection", () => {
    // minimalPayload: 1 section item + 1 flash
    expect(aihotDailyItemCount(minimalPayload)).toBe(2);
    expect(aihotDailyItemCount({ ...minimalPayload, flashes: [] })).toBe(1);
  });

  it("classifies the 2026-08-02 outage shape (2 items) as thin, healthy (20+) as rich", () => {
    // Mirrors the real outage report: 2 sections × 1 item, no lead, no flashes.
    const outageShaped: AihotDailyReport = {
      ...minimalPayload,
      lead: null,
      flashes: [],
      sections: [
        { label: "行业动态", items: [minimalPayload.sections[0]!.items[0]!] },
        { label: "技巧与观点", items: [minimalPayload.sections[0]!.items[0]!] },
      ],
    };
    expect(isThinAihotDaily(outageShaped)).toBe(true);
    expect(isThinAihotDaily(richPayload(20))).toBe(false);
  });

  it("pickRicherAihotDaily prefers the copy with more items, live on tie", () => {
    const thin: AihotDailyReport = { ...minimalPayload, flashes: [] };
    const rich = richPayload(10);
    expect(pickRicherAihotDaily(thin, rich)).toBe(rich);
    expect(pickRicherAihotDaily(rich, thin)).toBe(rich);
    expect(pickRicherAihotDaily(null, thin)).toBe(thin);
    expect(pickRicherAihotDaily(thin, null)).toBe(thin);
    expect(pickRicherAihotDaily(null, null)).toBeNull();
    // Tie → live wins (fresher generatedAt).
    const cachedTwin: AihotDailyReport = { ...rich, generatedAt: "old" };
    expect(pickRicherAihotDaily(cachedTwin, rich)).toBe(rich);
  });

  /** A payload with `n` flash items on top of minimalPayload's 1 section item. */
  function richPayload(n: number): AihotDailyReport {
    return {
      ...minimalPayload,
      generatedAt: "2026-05-08T12:22:00.000Z",
      flashes: Array.from({ length: n }, (_, i) => ({
        title: `flash ${i}`,
        sourceName: "X",
        sourceUrl: `https://example.com/${i}`,
        publishedAt: "2026-05-07T08:00:00.000Z",
      })),
    };
  }

  describe("resolveAihotDaily (cache-vs-live control flow)", () => {
    const thin: AihotDailyReport = { ...minimalPayload, flashes: [] };

    it("rich cache short-circuits — live fetch is never called", async () => {
      const rich = richPayload(20);
      let liveCalled = false;
      const out = await resolveAihotDaily({
        dateUtcYmd: "2026-08-02",
        cached: rich,
        fetchLive: async () => {
          liveCalled = true;
          return null;
        },
      });
      expect(out).toBe(rich);
      expect(liveCalled).toBe(false);
    });

    it("thin cache triggers a live fetch and the richer copy wins", async () => {
      const rich = richPayload(20);
      const out = await resolveAihotDaily({
        dateUtcYmd: "2026-08-02",
        cached: thin,
        fetchLive: async () => rich,
      });
      expect(out).toBe(rich);
    });

    it("thin cache + failing live fetch falls back to cached thin, never throws", async () => {
      const out = await resolveAihotDaily({
        dateUtcYmd: "2026-08-02",
        cached: thin,
        fetchLive: async () => {
          throw new Error("network down");
        },
      });
      expect(out).toBe(thin);
    });

    it("no cache + null live (404) resolves to null", async () => {
      const out = await resolveAihotDaily({
        dateUtcYmd: "2026-08-02",
        cached: null,
        fetchLive: async () => null,
      });
      expect(out).toBeNull();
    });
  });

  it("strips AI HOT paper sections before prompt rendering", () => {
    const payload: AihotDailyReport = {
      ...minimalPayload,
      lead: { title: "Paper item", leadParagraph: "Academic detail." },
      sections: [
        ...minimalPayload.sections,
        {
          label: "论文研究",
          items: [
            {
              title: "Paper item",
              summary: "A benchmark result.",
              sourceUrl: "https://example.com/p",
              sourceName: "Example",
            },
          ],
        },
      ],
      flashes: [
        ...minimalPayload.flashes,
        {
          title: "Paper item",
          sourceName: "Example",
          sourceUrl: "https://example.com/p",
          publishedAt: "2026-05-07T08:00:00.000Z",
        },
      ],
    };

    const stripped = stripPaperFromAihotDaily(payload);
    expect(stripped?.lead).toBeNull();
    expect(stripped?.sections.map((s) => s.label)).not.toContain("论文研究");
    expect(stripped?.flashes.map((f) => f.title)).not.toContain("Paper item");

    const out = renderAihotDailyForPrompt(payload);
    expect(out).not.toContain("论文研究");
    expect(out).not.toContain("Paper item");
  });
});
