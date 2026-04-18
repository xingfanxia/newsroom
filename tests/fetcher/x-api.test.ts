import { describe, expect, it } from "bun:test";
import {
  firstLineTitle,
  handleFromUrl,
  tweetToFeedItem,
  XApiError,
} from "@/workers/fetcher/x-api";

describe("handleFromUrl", () => {
  const valid = [
    ["https://x.com/dotey", "dotey"],
    ["https://x.com/Khazix0918", "Khazix0918"],
    ["https://www.x.com/Yuchenj_UW", "Yuchenj_UW"],
    ["https://x.com/op7418/", "op7418"],
    ["https://x.com/AnthropicAI?lang=zh", "AnthropicAI"],
    ["https://twitter.com/OpenAI", "OpenAI"],
    ["https://mobile.x.com/claudeai", "claudeai"],
  ] as const;

  for (const [url, expected] of valid) {
    it(`parses ${url} → @${expected}`, () => {
      expect(handleFromUrl(url)).toBe(expected);
    });
  }

  it("rejects URLs that aren't profile URLs", () => {
    expect(() => handleFromUrl("https://x.com/")).toThrow(XApiError);
    expect(() => handleFromUrl("https://x.com/home")).toThrow(XApiError);
    expect(() => handleFromUrl("https://x.com/i/timeline")).toThrow(XApiError);
    expect(() => handleFromUrl("https://x.com/search?q=foo")).toThrow(XApiError);
    expect(() => handleFromUrl("https://example.com/dotey")).toThrow(XApiError);
  });
});

describe("firstLineTitle", () => {
  it("returns the first line when already short", () => {
    expect(firstLineTitle("Hello world")).toBe("Hello world");
  });

  it("uses only the first line when multi-line", () => {
    expect(firstLineTitle("line one\n\nline two")).toBe("line one");
  });

  it("truncates long single lines at the last word boundary with ellipsis", () => {
    const long = "word ".repeat(40); // ~200 chars
    const out = firstLineTitle(long);
    expect(out.length).toBeLessThanOrEqual(121); // 120 chars + ellipsis
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("tweetToFeedItem", () => {
  const baseTweet = {
    id: "1234567890",
    text: "short tweet body",
    created_at: "2026-04-18T09:00:00Z",
    lang: "en",
  };

  it("builds a FeedItem with canonical permalink + published date", () => {
    const fi = tweetToFeedItem(baseTweet, "dotey");
    expect(fi).not.toBeNull();
    expect(fi!.externalId).toBe("1234567890");
    expect(fi!.url).toBe("https://x.com/dotey/status/1234567890");
    expect(fi!.title).toBe("short tweet body");
    expect(fi!.publishedAt?.toISOString()).toBe("2026-04-18T09:00:00.000Z");
  });

  it("prefers note_tweet.text over truncated text for long tweets", () => {
    const fullEssay = "long form thread ".repeat(50);
    const fi = tweetToFeedItem(
      {
        ...baseTweet,
        text: fullEssay.slice(0, 270) + "…",
        note_tweet: { text: fullEssay },
      },
      "khazix0918",
    );
    expect(fi).not.toBeNull();
    const body = (fi!.rawPayload as { body: string }).body;
    expect(body).toBe(fullEssay.trim());
    expect(body.includes("…")).toBe(false);
  });

  it("drops retweets", () => {
    const fi = tweetToFeedItem(
      {
        ...baseTweet,
        referenced_tweets: [{ type: "retweeted", id: "999" }],
      },
      "dotey",
    );
    expect(fi).toBeNull();
  });

  it("drops replies", () => {
    const fi = tweetToFeedItem(
      {
        ...baseTweet,
        referenced_tweets: [{ type: "replied_to", id: "999" }],
      },
      "dotey",
    );
    expect(fi).toBeNull();
  });

  it("keeps quote tweets — they're original commentary on someone else's post", () => {
    const fi = tweetToFeedItem(
      {
        ...baseTweet,
        text: "worth reading",
        referenced_tweets: [{ type: "quoted", id: "999" }],
      },
      "dotey",
    );
    expect(fi).not.toBeNull();
  });

  it("drops tweets with no text body at all", () => {
    const fi = tweetToFeedItem({ ...baseTweet, text: "   " }, "dotey");
    expect(fi).toBeNull();
  });

  it("exposes body + content:encoded in rawPayload for the normalizer", () => {
    const fi = tweetToFeedItem(baseTweet, "dotey");
    const payload = fi!.rawPayload as Record<string, unknown>;
    expect(payload.body).toBe("short tweet body");
    expect(payload["content:encoded"]).toBe("short tweet body");
  });
});
