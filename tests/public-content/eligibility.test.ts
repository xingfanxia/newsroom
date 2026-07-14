import { describe, expect, test } from "bun:test";
import {
  eligibleCanonicalItemIds,
  isEligiblePublicEvent,
  isEligiblePublicItem,
  retainPublicSourceHistory,
} from "@/lib/public-content/eligibility";
import { deriveWhyFeatured } from "@/lib/public-content/public-rubric";
import {
  objectKey,
  releaseManifestKey,
  runReceiptKey,
} from "@/lib/public-content/paths";

const HASH = "a".repeat(64);
const ISO = "2026-07-14T12:00:00.000Z";

function eligibleItem(id = 1) {
  return {
    id,
    enrichedAt: ISO,
    importance: 80,
    tier: "featured" as const,
    intendedPublic: true,
  };
}

describe("public item eligibility", () => {
  test("fails closed for unenriched, excluded, unknown-tier, no-score, or private rows", () => {
    expect(isEligiblePublicItem(eligibleItem())).toBe(true);
    expect(
      isEligiblePublicItem({ ...eligibleItem(), enrichedAt: null }),
    ).toBe(false);
    expect(
      isEligiblePublicItem({ ...eligibleItem(), tier: "excluded" }),
    ).toBe(false);
    expect(isEligiblePublicItem({ ...eligibleItem(), tier: null })).toBe(false);
    expect(
      isEligiblePublicItem({ ...eligibleItem(), tier: "future-tier" }),
    ).toBe(false);
    expect(
      isEligiblePublicItem({ ...eligibleItem(), importance: null }),
    ).toBe(false);
    expect(
      isEligiblePublicItem({ ...eligibleItem(), intendedPublic: false }),
    ).toBe(false);
    for (const malformed of [
      { ...eligibleItem(), enrichedAt: undefined },
      { ...eligibleItem(), enrichedAt: "" },
      { ...eligibleItem(), intendedPublic: "false" },
    ]) {
      expect(isEligiblePublicItem(malformed as never)).toBe(false);
    }
    expect(() => isEligiblePublicItem(null as never)).not.toThrow();
    expect(isEligiblePublicItem(null as never)).toBe(false);
  });

  test("does not confuse a zero importance score with missing data", () => {
    expect(isEligiblePublicItem({ ...eligibleItem(), importance: 0 })).toBe(
      true,
    );
  });

  test("retains all eligible event members for detail, not only the lead", () => {
    const members = [
      eligibleItem(10),
      { ...eligibleItem(11), tier: "all" as const },
      { ...eligibleItem(12), enrichedAt: null },
    ];
    expect(eligibleCanonicalItemIds(members)).toEqual([10, 11]);
  });
});

describe("public event eligibility", () => {
  const members = [eligibleItem(10), { ...eligibleItem(11), tier: "all" as const }];
  const event = {
    leadItemId: 10,
    memberItemIds: [10, 11],
    noContent: false,
    tier: "p1" as const,
  };

  test("requires a valid eligible lead that belongs to the event", () => {
    expect(isEligiblePublicEvent(event, members)).toBe(true);
    expect(
      isEligiblePublicEvent({ ...event, leadItemId: 99 }, members),
    ).toBe(false);
    expect(
      isEligiblePublicEvent({ ...event, memberItemIds: [11] }, members),
    ).toBe(false);
    expect(
      isEligiblePublicEvent({ ...event, memberItemIds: [10] }, members),
    ).toBe(false);
    expect(isEligiblePublicEvent(event, [members[0]!])).toBe(false);
    expect(
      isEligiblePublicEvent(event, [
        members[0]!,
        { ...members[1]!, tier: "excluded" },
      ]),
    ).toBe(false);
    expect(() => isEligiblePublicEvent(null as never, members)).not.toThrow();
    expect(isEligiblePublicEvent(null as never, members)).toBe(false);
    expect(isEligiblePublicEvent(event, null as never)).toBe(false);
    expect(
      isEligiblePublicEvent(event, [
        { ...eligibleItem(10), enrichedAt: null },
        members[1]!,
      ]),
    ).toBe(false);
  });

  test("rejects no-content and excluded or unknown effective tiers", () => {
    expect(isEligiblePublicEvent({ ...event, noContent: true }, members)).toBe(
      false,
    );
    expect(
      isEligiblePublicEvent({ ...event, tier: "excluded" }, members),
    ).toBe(false);
    expect(
      isEligiblePublicEvent({ ...event, tier: "future-tier" }, members),
    ).toBe(false);
    for (const noContent of [undefined, null, 0]) {
      expect(
        isEligiblePublicEvent({ ...event, noContent } as never, members),
      ).toBe(false);
    }
  });

  test("falls back to the eligible lead tier when event tier is absent", () => {
    expect(isEligiblePublicEvent({ ...event, tier: null }, members)).toBe(true);
    expect(
      isEligiblePublicEvent({ ...event, tier: undefined } as never, members),
    ).toBe(false);
  });

  test("does not promote another member when the canonical lead is invalid", () => {
    const invalidLead = [
      { ...eligibleItem(10), tier: "excluded" as const },
      eligibleItem(11),
    ];
    expect(isEligiblePublicEvent(event, invalidLead)).toBe(false);
  });
});

describe("source history and public rubric", () => {
  test("source ingestion state never erases historical public records", () => {
    expect(retainPublicSourceHistory({ enabled: true })).toBe(true);
    expect(retainPublicSourceHistory({ enabled: false })).toBe(true);
  });

  test("derives localized why-featured copy from public facts only", () => {
    const facts = {
      tier: "featured" as const,
      importance: 90,
      hkr: { h: true, k: false, r: true },
    };
    expect(deriveWhyFeatured({ ...facts, locale: "en" })).toBe(
      "Featured · importance 90 · hook + resonance",
    );
    expect(deriveWhyFeatured({ ...facts, locale: "zh" })).toBe(
      "精选 · 重要度 90 · 吸引力 + 共鸣",
    );
    expect(
      deriveWhyFeatured({
        ...facts,
        locale: "en",
        reasoning: "must never influence output",
      } as typeof facts & { locale: "en"; reasoning: string }),
    ).toBe("Featured · importance 90 · hook + resonance");
    expect(
      deriveWhyFeatured({
        locale: "en",
        tier: "all",
        importance: 80,
        hkr: null,
      }),
    ).toBeNull();
    for (const malformed of [
      { ...facts, locale: "en", importance: "90" },
      { ...facts, locale: "en", importance: 101 },
      { ...facts, locale: "future" },
      { ...facts, locale: "en", hkr: { h: "true", k: false, r: true } },
    ]) {
      expect(deriveWhyFeatured(malformed as never)).toBeNull();
    }
    expect(() => deriveWhyFeatured(null as never)).not.toThrow();
    expect(deriveWhyFeatured(null as never)).toBeNull();
  });
});

describe("R2 key grammar", () => {
  test("builds only the frozen namespace", () => {
    expect(objectKey(HASH, "json")).toBe(
      `newsroom/v1/objects/sha256/${HASH}.json`,
    );
    expect(releaseManifestKey("20260714t120000z-a1b2c3")).toBe(
      "newsroom/v1/releases/20260714t120000z-a1b2c3/manifest.json",
    );
  });

  test("rejects traversal, encoding, uppercase hashes, and invalid dates", () => {
    for (const releaseId of [
      "../private",
      "/absolute",
      "back\\slash",
      "%2e%2e",
      "release?query",
      "release#fragment",
      "UPPERCASE",
    ]) {
      expect(() => releaseManifestKey(releaseId), releaseId).toThrow();
    }
    expect(() => objectKey("A".repeat(64), "json")).toThrow();
    expect(() => objectKey(HASH.slice(1), "json")).toThrow();
    expect(() => runReceiptKey("2026-02-30", "valid-run")).toThrow();
  });
});
