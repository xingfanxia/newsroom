import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import {
  renderLegacyPublicRss,
  renderMainPublicRss,
  renderStructuredNewsletterPublicRss,
} from "@/lib/public-content/rss";
import { RSS_CONTENT_TYPE, rssCacheControl } from "@/lib/rss/http-contract";
import {
  EXPECTED_RSS_SHA256,
  PARITY_NOW_MS,
  PARITY_STATE,
} from "./fixtures/parity-corpus";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

describe("pure public RSS artifacts", () => {
  test("matches hash-frozen exact main-feed bytes in both locales", () => {
    const zh = renderMainPublicRss(PARITY_STATE, "zh", PARITY_NOW_MS);
    const en = renderMainPublicRss(PARITY_STATE, "en", PARITY_NOW_MS);
    expect(sha256(zh.xml)).toBe(EXPECTED_RSS_SHA256.mainZh);
    expect(sha256(en.xml)).toBe(EXPECTED_RSS_SHA256.mainEn);
    expect(zh.contentType).toBe(RSS_CONTENT_TYPE);
    expect(zh.cacheControl).toBe(rssCacheControl());
    expect(zh.xml).toContain('<guid isPermaLink="true">https://example.com/items/1</guid>');
    expect(en.xml).toContain("Alpha event");
  });

  test("matches structured-newsletter bytes and headers", () => {
    const artifact = renderStructuredNewsletterPublicRss(
      PARITY_STATE,
      "en",
      PARITY_NOW_MS,
    );
    expect(sha256(artifact.xml)).toBe(EXPECTED_RSS_SHA256.newsletterEn);
    expect(artifact.contentType).toBe(RSS_CONTENT_TYPE);
    expect(artifact.xml).toContain("[Daily] Daily signal");
    expect(artifact.xml).toContain("Jul 14 – Jul 14");
  });

  test("matches legacy today, curated and daily byte fixtures", () => {
    const today = renderLegacyPublicRss(PARITY_STATE, "today", PARITY_NOW_MS);
    const curated = renderLegacyPublicRss(PARITY_STATE, "curated", PARITY_NOW_MS);
    const daily = renderLegacyPublicRss(PARITY_STATE, "daily", PARITY_NOW_MS);
    expect(sha256(today.xml)).toBe(EXPECTED_RSS_SHA256.legacyToday);
    expect(sha256(curated.xml)).toBe(EXPECTED_RSS_SHA256.legacyCurated);
    expect(sha256(daily.xml)).toBe(EXPECTED_RSS_SHA256.legacyDaily);
    expect(curated.xml).not.toContain("Alpha follow-up");
    expect(daily.xml).toContain("AX 的 AI 日报 · 2026-07-14");

    const knownWrongGuid = today.xml.replace('isPermaLink="false"', 'isPermaLink="true"');
    expect(sha256(knownWrongGuid)).not.toBe(EXPECTED_RSS_SHA256.legacyToday);
  });
});
