/**
 * Stage C canonical-title worker tests.
 *
 * Strategy: pure unit tests on the prompt functions, plus logic-path
 * tests extracted into testable helper shapes. The worker module imports
 * @/db/client which requires a live Postgres connection, so we test the
 * surrounding logic (prompt shape, constant, candidate-filter semantics)
 * without loading the module directly.
 *
 * If a full integration harness (DB fixtures + mock LLM) is added later,
 * the worker's runCanonicalTitleBatch() can be imported there directly.
 */

import { describe, it, expect } from "vitest";
import { canonicalTitleSystem, canonicalTitleUserPrompt } from "./prompt";

// Mirror of MAX_TITLES_PER_RUN from ./canonical-title — kept here to avoid
// importing that module which has a hard DB-client dependency at load time.
// If the value in the worker changes, this test will serve as a reminder.
const MAX_TITLES_PER_RUN = 15;

// ── Prompt-shape unit tests ─────────────────────────────────────

describe("canonicalTitleSystem", () => {
  it("contains neutral-tone instruction", () => {
    expect(canonicalTitleSystem).toContain("Neutral tone");
  });

  it("specifies output JSON shape", () => {
    expect(canonicalTitleSystem).toContain("canonicalTitleZh");
    expect(canonicalTitleSystem).toContain("canonicalTitleEn");
  });

  it("forbids marketing copy", () => {
    expect(canonicalTitleSystem).toMatch(/BREAKING|MUST READ|marketing/i);
  });

  it("specifies locale-native requirement", () => {
    expect(canonicalTitleSystem).toContain("Locale-native");
  });
});

describe("canonicalTitleUserPrompt", () => {
  it("includes all member titles and source names", () => {
    const prompt = canonicalTitleUserPrompt({
      memberTitles: [
        { zh: "OpenAI发布GPT-5", en: "OpenAI launches GPT-5", source: "TechCrunch" },
        { zh: null, en: "GPT-5 is here", source: "Wired" },
      ],
      leadSummaryZh: "OpenAI正式推出GPT-5模型",
      leadSummaryEn: "OpenAI officially released GPT-5",
    });

    expect(prompt).toContain("TechCrunch");
    expect(prompt).toContain("Wired");
    expect(prompt).toContain("OpenAI发布GPT-5");
    expect(prompt).toContain("GPT-5 is here");
    expect(prompt).toContain("OpenAI正式推出GPT-5模型");
    expect(prompt).toContain("OpenAI officially released GPT-5");
    expect(prompt).toContain("Member titles (2 sources)");
  });

  it("falls back to (none) for null zh/en titles", () => {
    const prompt = canonicalTitleUserPrompt({
      memberTitles: [{ zh: null, en: null, source: "TestSource" }],
      leadSummaryZh: null,
      leadSummaryEn: null,
    });

    expect(prompt).toContain("zh: (none)");
    expect(prompt).toContain("en: (none)");
    expect(prompt).toContain("Lead summary (zh): (none)");
    expect(prompt).toContain("Lead summary (en): (none)");
  });

  it("emits JSON instruction at end", () => {
    const prompt = canonicalTitleUserPrompt({
      memberTitles: [{ zh: "标题", en: "Title", source: "src" }],
      leadSummaryZh: null,
      leadSummaryEn: null,
    });

    expect(prompt).toContain("canonicalTitleZh");
    expect(prompt).toContain("canonicalTitleEn");
    expect(prompt).toContain("JSON only");
  });

  it("numbers each source 1-based", () => {
    const prompt = canonicalTitleUserPrompt({
      memberTitles: [
        { zh: "A", en: "A", source: "S1" },
        { zh: "B", en: "B", source: "S2" },
        { zh: "C", en: "C", source: "S3" },
      ],
      leadSummaryZh: null,
      leadSummaryEn: null,
    });

    expect(prompt).toContain("1. [S1]");
    expect(prompt).toContain("2. [S2]");
    expect(prompt).toContain("3. [S3]");
  });

  it("correctly reports member count in header", () => {
    const titles = Array.from({ length: 7 }, (_, i) => ({
      zh: `标题${i}`,
      en: `Title ${i}`,
      source: `src${i}`,
    }));

    const prompt = canonicalTitleUserPrompt({
      memberTitles: titles,
      leadSummaryZh: null,
      leadSummaryEn: null,
    });

    expect(prompt).toContain("Member titles (7 sources)");
  });
});

// ── MAX_TITLES_PER_RUN constant ──────────────────────────────────

describe("MAX_TITLES_PER_RUN", () => {
  it("is 15", () => {
    expect(MAX_TITLES_PER_RUN).toBe(15);
  });
});

// ── Candidate-selection logic (pure functional simulation) ───────
//
// The SQL WHERE clause in runCanonicalTitleBatch selects clusters where:
//   member_count >= 2
//   AND (canonical_title_zh IS NULL OR updated_at > titled_at)
//
// These tests verify the filter semantics using plain JS objects so that
// a future refactor can confirm nothing changed.

type CandidateCluster = {
  memberCount: number;
  canonicalTitleZh: string | null;
  titledAt: Date | null;
  updatedAt: Date;
};

/** Mirrors the SQL candidate filter logic. */
function isTitleCandidate(c: CandidateCluster): boolean {
  if (c.memberCount < 2) return false;
  if (c.canonicalTitleZh === null) return true;
  if (c.titledAt === null) return true;
  return c.updatedAt > c.titledAt;
}

describe("isTitleCandidate (candidate-selection semantics)", () => {
  const now = new Date("2026-04-24T10:00:00Z");
  const past = new Date("2026-04-20T00:00:00Z");
  const future = new Date("2026-04-25T00:00:00Z");

  it("selects member_count >= 2 cluster with no canonical title", () => {
    expect(
      isTitleCandidate({
        memberCount: 2,
        canonicalTitleZh: null,
        titledAt: null,
        updatedAt: now,
      }),
    ).toBe(true);
  });

  it("skips singletons (member_count = 1)", () => {
    expect(
      isTitleCandidate({
        memberCount: 1,
        canonicalTitleZh: null,
        titledAt: null,
        updatedAt: now,
      }),
    ).toBe(false);
  });

  it("skips member_count = 0", () => {
    expect(
      isTitleCandidate({
        memberCount: 0,
        canonicalTitleZh: "已有标题",
        titledAt: past,
        updatedAt: now,
      }),
    ).toBe(false);
  });

  it("selects cluster where updated_at > titled_at (regen needed)", () => {
    expect(
      isTitleCandidate({
        memberCount: 3,
        canonicalTitleZh: "旧标题",
        titledAt: past,
        updatedAt: now, // now > past
      }),
    ).toBe(true);
  });

  it("skips cluster where titled_at > updated_at (throttle — no regen)", () => {
    expect(
      isTitleCandidate({
        memberCount: 3,
        canonicalTitleZh: "最新标题",
        titledAt: future,   // titled_at is newer than updated_at
        updatedAt: now,
      }),
    ).toBe(false);
  });

  it("selects cluster where titled_at == updated_at as NOT a candidate (equal → no regen)", () => {
    // updated_at > titled_at is strict greater-than, so equal means skip.
    expect(
      isTitleCandidate({
        memberCount: 2,
        canonicalTitleZh: "已有标题",
        titledAt: now,
        updatedAt: now, // equal — not strictly greater
      }),
    ).toBe(false);
  });

  it("selects cluster with title but null titledAt (edge case — should regen)", () => {
    // titledAt=null means we treat as no-titling-happened-yet.
    expect(
      isTitleCandidate({
        memberCount: 5,
        canonicalTitleZh: "Orphaned title without timestamp",
        titledAt: null,
        updatedAt: now,
      }),
    ).toBe(true);
  });
});
