import { describe, expect, test } from "bun:test";
import {
  RSS_CONTENT_TYPE,
  RSS_DEFAULT_CACHE,
  RSS_RATE_LIMIT_MAX,
  RSS_RATE_LIMIT_WINDOW_MS,
  rssCacheControl,
  rssRateLimitReqLabel,
} from "@/lib/rss/http-contract";

describe("RSS HTTP contract", () => {
  test("exposes the shared RSS content type and default cache-control label", () => {
    expect(RSS_CONTENT_TYPE).toBe("application/rss+xml; charset=utf-8");
    expect(RSS_DEFAULT_CACHE).toEqual({
      maxAge: 600,
      sMaxAge: 600,
      staleWhileRevalidate: 3600,
    });
    expect(rssCacheControl()).toBe(
      "public, max-age=600, s-maxage=600, stale-while-revalidate=3600",
    );
  });

  test("exposes the shared RSS per-IP rate-limit label", () => {
    expect(RSS_RATE_LIMIT_MAX).toBe(60);
    expect(RSS_RATE_LIMIT_WINDOW_MS).toBe(60 * 60 * 1000);
    expect(rssRateLimitReqLabel()).toBe("60 req/h");
  });
});
