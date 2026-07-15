import { describe, expect, test } from "bun:test";
import {
  canonicalStateSchema,
  publicEventSchema,
  publicItemSchema,
  publicNewsletterSchema,
  publicPolicySchema,
  publicSourceSchema,
} from "@/lib/public-content/contracts";
import {
  canonicalState,
  event,
  item,
  newsletter,
  policy,
  source,
} from "./contract-fixtures";

describe("schema-v1 persisted contracts", () => {
  test("accept the complete public record set", () => {
    expect(publicItemSchema.parse(item()).id).toBe(1);
    expect(publicEventSchema.parse(event()).coverage).toBe(2);
    expect(publicSourceSchema.parse(source()).enabled).toBe(false);
    expect(publicNewsletterSchema.parse(newsletter()).format).toBe(
      "daily_column",
    );
    expect(publicPolicySchema.parse(policy()).version).toBe("v17");
    expect(canonicalStateSchema.parse(canonicalState()).items).toHaveLength(2);
  });

  test("reject unknown schema versions without coercion", () => {
    const contracts: Array<{
      schema: { safeParse: (value: unknown) => { success: boolean } };
      valid: Record<string, unknown>;
    }> = [
      { schema: publicItemSchema, valid: item() },
      { schema: publicEventSchema, valid: event() },
      { schema: publicSourceSchema, valid: source() },
      { schema: publicNewsletterSchema, valid: newsletter() },
      { schema: publicPolicySchema, valid: policy() },
      { schema: canonicalStateSchema, valid: canonicalState() },
    ];
    for (const { schema, valid } of contracts) {
      expect(schema.safeParse({ ...valid, schemaVersion: 2 }).success).toBe(false);
      expect(schema.safeParse({ ...valid, schemaVersion: "1" }).success).toBe(
        false,
      );
    }
  });

  test("strictly rejects private and raw fields instead of stripping them", () => {
    const itemSentinels = [
      "reasoning",
      "reasoningZh",
      "reasoningEn",
      "hkrReasons",
      "hkrExplanation",
      "whyFeatured",
      "body",
      "bodyRss",
      "rawBody",
      "rawRss",
      "rawPayload",
      "embedding",
      "embeddingSmall",
      "enrichClaimedAt",
      "claim",
      "claimedAt",
      "errors",
      "enrichAttempts",
      "enrichError",
      "clusterVerifiedAt",
    ];
    for (const key of itemSentinels) {
      expect(
        publicItemSchema.safeParse({ ...item(), [key]: "PRIVATE" }).success,
        key,
      ).toBe(false);
    }

    for (const key of [
      "reasoning",
      "reasoningZh",
      "reasoningEn",
      "hkrReasons",
      "noContent",
      "commentaryMemberCount",
      "verifiedAt",
    ]) {
      expect(
        publicEventSchema.safeParse({ ...event(), [key]: "PRIVATE" }).success,
        key,
      ).toBe(false);
    }

    for (const key of [
      "notes",
      "errors",
      "lastError",
      "lastFetchedAt",
      "lastExternalId",
      "neverExclude",
    ]) {
      expect(
        publicSourceSchema.safeParse({ ...source(), [key]: "PRIVATE" }).success,
        key,
      ).toBe(false);
    }

    for (const key of ["aihotDailyPayload", "aihotDailyDate", "rawPayload"]) {
      expect(
        publicNewsletterSchema.safeParse({
          ...newsletter(),
          [key]: "PRIVATE",
        }).success,
        key,
      ).toBe(false);
    }

    for (const key of ["content", "reasoning", "feedback", "committedBy"]) {
      expect(
        publicPolicySchema.safeParse({ ...policy(), [key]: "PRIVATE" }).success,
        key,
      ).toBe(false);
    }

    for (const key of [
      "users",
      "feedback",
      "saved",
      "tweaks",
      "tokens",
      "usage",
      "iterationOutput",
    ]) {
      expect(
        canonicalStateSchema.safeParse({
          ...canonicalState(),
          [key]: "PRIVATE",
        }).success,
        key,
      ).toBe(false);
    }
  });

  test("strictness reaches nested persisted objects", () => {
    expect(
      publicItemSchema.safeParse({
        ...item(),
        hkr: { h: true, k: true, r: false, reasonsZh: { h: "private" } },
      }).success,
    ).toBe(false);
    expect(
      publicSourceSchema.safeParse({
        ...source(),
        health: { ...source().health, lastError: "private" },
      }).success,
    ).toBe(false);
  });

  test("allows only web URLs in public links and RSS inputs", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,private",
      "file:///etc/passwd",
    ]) {
      expect(
        publicItemSchema.safeParse({
          ...item(),
          url,
          canonicalUrl: url,
        }).success,
        url,
      ).toBe(false);
      expect(publicSourceSchema.safeParse({ ...source(), url }).success, url).toBe(
        false,
      );
    }
    expect(() =>
      publicItemSchema.safeParse({
        ...item(),
        url: "not a url",
        canonicalUrl: "not a url",
      }),
    ).not.toThrow();
    expect(
      publicSourceSchema.safeParse({
        ...source(),
        id: "aihot-selected",
        url: "internal://aihot-selected",
      }).success,
    ).toBe(true);
    expect(
      publicSourceSchema.safeParse({
        ...source(),
        id: "crunchbase-ai",
        url: "internal://crunchbase",
      }).success,
    ).toBe(true);
    expect(
      publicSourceSchema.safeParse({
        ...source(),
        id: "x-ai-watchlist",
        url: "internal://x-watchlist",
      }).success,
    ).toBe(true);
    expect(
      publicSourceSchema.safeParse({
        ...source(),
        url: "internal://private/path",
      }).success,
    ).toBe(false);
  });

  test("requires valid score, event, and newsletter invariants", () => {
    for (const importance of [-1, 1.5, 101]) {
      expect(
        publicItemSchema.safeParse({ ...item(), importance }).success,
      ).toBe(false);
      expect(
        publicEventSchema.safeParse({ ...event(), importance }).success,
      ).toBe(false);
    }
    expect(
      publicEventSchema.safeParse({
        ...event(),
        memberItemIds: [1],
        coverage: 1,
      }).success,
    ).toBe(false);
    expect(
      publicEventSchema.safeParse({
        ...event(),
        latestMemberAt: "2026-07-14T11:00:00.000Z",
      }).success,
    ).toBe(false);
    expect(
      publicNewsletterSchema.safeParse({
        ...newsletter(),
        featuredItemIds: [999],
      }).success,
    ).toBe(false);
    expect(
      publicNewsletterSchema.safeParse({
        ...newsletter(),
        periodEnd: "2026-07-14T11:00:00.000Z",
      }).success,
    ).toBe(false);
  });
});

describe("canonical state references", () => {
  test("reject duplicate IDs and dangling entity references", () => {
    const state = canonicalState();
    expect(
      canonicalStateSchema.safeParse({ ...state, items: [item(), item()] })
        .success,
    ).toBe(false);
    expect(
      canonicalStateSchema.safeParse({
        ...state,
        events: [{ ...event(), leadItemId: 999 }],
      }).success,
    ).toBe(false);
    expect(
      canonicalStateSchema.safeParse({
        ...state,
        items: [{ ...item(), sourceId: "missing-source" }, item(2)],
      }).success,
    ).toBe(false);
    expect(
      canonicalStateSchema.safeParse({
        ...state,
        items: [{ ...state.items[0]!, eventId: null }, state.items[1]!],
      }).success,
    ).toBe(false);
  });
});
