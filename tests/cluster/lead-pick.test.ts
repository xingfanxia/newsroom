/**
 * Unit tests for workers/cluster/lead-pick.ts.
 *
 * Pure logic tests — no DB. Each test constructs a small member list and
 * asserts the right candidate wins under the authority + priority +
 * importance + tiebreak rules.
 */
import { describe, expect, it } from "bun:test";
import {
  authorityScore,
  pickBestLead,
  type LeadCandidate,
} from "../../workers/cluster/lead-pick";

function candidate(
  partial: Partial<LeadCandidate> & Pick<LeadCandidate, "itemId" | "sourceGroup">,
): LeadCandidate {
  return {
    sourcePriority: 2,
    importance: null,
    publishedAt: new Date("2026-04-25T00:00:00Z"),
    ...partial,
  };
}

describe("authorityScore — group ladder", () => {
  it("vendor-official > media > social", () => {
    const v = authorityScore(candidate({ itemId: 1, sourceGroup: "vendor-official" }));
    const m = authorityScore(candidate({ itemId: 2, sourceGroup: "media" }));
    const s = authorityScore(candidate({ itemId: 3, sourceGroup: "social" }));
    expect(v).toBeGreaterThan(m);
    expect(m).toBeGreaterThan(s);
  });

  it("research ties media (papers are source of truth like vendor blogs)", () => {
    const r = authorityScore(candidate({ itemId: 1, sourceGroup: "research" }));
    const m = authorityScore(candidate({ itemId: 2, sourceGroup: "media" }));
    expect(r).toBe(m);
  });

  it("product (Product Hunt) outranks social", () => {
    const p = authorityScore(candidate({ itemId: 1, sourceGroup: "product" }));
    const s = authorityScore(candidate({ itemId: 2, sourceGroup: "social" }));
    expect(p).toBeGreaterThan(s);
  });
});

describe("authorityScore — priority offset", () => {
  it("priority=1 beats priority=2 within same group", () => {
    const hi = authorityScore(
      candidate({ itemId: 1, sourceGroup: "media", sourcePriority: 1 }),
    );
    const lo = authorityScore(
      candidate({ itemId: 2, sourceGroup: "media", sourcePriority: 2 }),
    );
    expect(hi).toBeGreaterThan(lo);
  });

  it("priority=1 media (HN/Bloomberg/FT, score 100) ties vendor-official priority=2 (score 100)", () => {
    // The rationale for the ladder: hand-picked top media (priority=1) is the
    // editorial paper of record; default-priority vendor-official is also high
    // but operator hasn't elevated it. Treat as equal — let importance tiebreak.
    const m = authorityScore(
      candidate({ itemId: 1, sourceGroup: "media", sourcePriority: 1 }),
    );
    const v = authorityScore(
      candidate({ itemId: 2, sourceGroup: "vendor-official", sourcePriority: 2 }),
    );
    expect(m).toBe(v);
  });
});

describe("authorityScore — importance bonus", () => {
  it("importance contributes as a tiebreaker, not a primary signal", () => {
    // A high-importance social post should NOT outrank a default vendor-official.
    const social_max = authorityScore(
      candidate({ itemId: 1, sourceGroup: "social", importance: 100 }),
    );
    const vendor_default = authorityScore(
      candidate({ itemId: 2, sourceGroup: "vendor-official", importance: 0 }),
    );
    expect(vendor_default).toBeGreaterThan(social_max);
  });

  it("breaks ties between same-group siblings", () => {
    const hi = authorityScore(
      candidate({ itemId: 1, sourceGroup: "media", importance: 80 }),
    );
    const lo = authorityScore(
      candidate({ itemId: 2, sourceGroup: "media", importance: 40 }),
    );
    expect(hi).toBeGreaterThan(lo);
  });
});

// ── pickBestLead ────────────────────────────────────────────────────────────

describe("pickBestLead — the user-reported cases", () => {
  it("DeepSeek V4 cluster: HN beats r/LocalLLaMA + Product Hunt", () => {
    // Real cluster from the user's screenshot — 9 members, lead was r/LocalLLaMA,
    // user complained the source label is wrong. With authority-aware picking,
    // Hacker News (media, priority=1) should win over the Reddit posts (social).
    const members: LeadCandidate[] = [
      candidate({
        itemId: 1,
        sourceGroup: "media",
        sourcePriority: 1, // Hacker News Frontpage
        publishedAt: new Date("2026-04-22T20:00:00Z"),
      }),
      candidate({
        itemId: 2,
        sourceGroup: "social",
        publishedAt: new Date("2026-04-22T19:00:00Z"), // earliest, but social
      }),
      candidate({
        itemId: 3,
        sourceGroup: "product",
        publishedAt: new Date("2026-04-22T20:30:00Z"), // Product Hunt
      }),
    ];
    expect(pickBestLead(members).itemId).toBe(1);
  });

  it("GPT-5.5 cluster: vendor-official X · @OpenAI beats X · @dotey", () => {
    // Real cluster from the user's screenshot — 9 members, lead was X · @dotey
    // (social), but the cluster contains both X · @OpenAI (vendor-official) and
    // OpenAI Blog (vendor-official). Either vendor source should win.
    const members: LeadCandidate[] = [
      candidate({
        itemId: 1,
        sourceGroup: "social", // X · @dotey (current bad lead)
        publishedAt: new Date("2026-04-23T11:52:00Z"),
      }),
      candidate({
        itemId: 2,
        sourceGroup: "vendor-official",
        sourcePriority: 1, // X · @OpenAI
        publishedAt: new Date("2026-04-23T18:06:00Z"),
      }),
      candidate({
        itemId: 3,
        sourceGroup: "vendor-official",
        sourcePriority: 1, // OpenAI Blog
        publishedAt: new Date("2026-04-23T11:00:00Z"),
      }),
      candidate({
        itemId: 4,
        sourceGroup: "media", // Hacker News
        sourcePriority: 1,
        publishedAt: new Date("2026-04-23T18:00:00Z"),
      }),
    ];
    const winner = pickBestLead(members);
    // Both vendor-official members tie; tiebreak by earlier publishedAt → OpenAI Blog (id=3).
    expect(winner.itemId).toBe(3);
    expect(winner.sourceGroup).toBe("vendor-official");
  });
});

describe("pickBestLead — tiebreaks", () => {
  it("earlier publishedAt wins when scores tie", () => {
    const members: LeadCandidate[] = [
      candidate({
        itemId: 1,
        sourceGroup: "media",
        publishedAt: new Date("2026-04-25T12:00:00Z"),
      }),
      candidate({
        itemId: 2,
        sourceGroup: "media",
        publishedAt: new Date("2026-04-25T10:00:00Z"), // earlier
      }),
    ];
    expect(pickBestLead(members).itemId).toBe(2);
  });

  it("lowest itemId wins when score AND publishedAt tie", () => {
    const t = new Date("2026-04-25T12:00:00Z");
    const members: LeadCandidate[] = [
      candidate({ itemId: 5, sourceGroup: "media", publishedAt: t }),
      candidate({ itemId: 2, sourceGroup: "media", publishedAt: t }),
      candidate({ itemId: 8, sourceGroup: "media", publishedAt: t }),
    ];
    expect(pickBestLead(members).itemId).toBe(2);
  });

  it("throws on empty member list", () => {
    expect(() => pickBestLead([])).toThrow();
  });
});
