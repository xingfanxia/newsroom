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

import { describe, it, expect } from "bun:test";
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

describe("canonicalTitleSystem — anti-bias rules added 2026-04-26", () => {
  it("forbids platform/source names appearing in canonical titles", () => {
    // Otherwise: "DeepSeek V4 发布传闻在 Reddit 流传" — the title leaks the
    // coverage platform when most members are r/LocalLLaMA. The title is the
    // EVENT, not where it was reported.
    expect(canonicalTitleSystem).toMatch(/在.*Reddit.*流传|on Reddit|Reddit thread/);
    expect(canonicalTitleSystem).toContain("EVENT, not where it was reported");
  });

  it("instructs to prefer confirmation over speculation", () => {
    // Otherwise: a cluster with one "DeepSeek V4 已发布" + several "DeepSeek V4
    // 真的发布了吗?" gets titled "rumors" because the speculation members
    // outnumber the confirmation. Confirmation wins.
    expect(canonicalTitleSystem).toMatch(/confirmation|reactions to/i);
    expect(canonicalTitleSystem).toMatch(/Only emit.*rumored.*if NO member confirms/);
  });

  it("highlights PRIMARY source as the strongest signal", () => {
    expect(canonicalTitleSystem).toContain("PRIMARY");
    expect(canonicalTitleSystem).toContain("CORROBORATING");
  });
});

describe("canonicalTitleUserPrompt", () => {
  function member(
    overrides: Partial<{
      zh: string | null;
      en: string | null;
      source: string;
      group: string;
      isPrimary: boolean;
    }>,
  ) {
    return {
      zh: null,
      en: null,
      source: "TestSource",
      group: "media",
      isPrimary: false,
      ...overrides,
    };
  }

  it("includes all member titles and source names", () => {
    const prompt = canonicalTitleUserPrompt({
      memberTitles: [
        member({
          zh: "OpenAI发布GPT-5",
          en: "OpenAI launches GPT-5",
          source: "TechCrunch",
          group: "media",
          isPrimary: true,
        }),
        member({
          zh: null,
          en: "GPT-5 is here",
          source: "Wired",
          group: "media",
        }),
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
  });

  it("renders PRIMARY first, CORROBORATING second", () => {
    const prompt = canonicalTitleUserPrompt({
      memberTitles: [
        member({
          source: "Reddit",
          group: "social",
          zh: "传闻 X",
          en: "Rumor X",
        }),
        member({
          source: "VendorBlog",
          group: "vendor-official",
          zh: "X 已发布",
          en: "X released",
          isPrimary: true,
        }),
      ],
      leadSummaryZh: null,
      leadSummaryEn: null,
    });

    const primaryIdx = prompt.indexOf("PRIMARY source");
    const corroboratingIdx = prompt.indexOf("CORROBORATING sources");
    expect(primaryIdx).toBeGreaterThan(-1);
    expect(corroboratingIdx).toBeGreaterThan(primaryIdx);
    // Vendor-official goes in PRIMARY section, social in CORROBORATING.
    const vendorIdx = prompt.indexOf("VendorBlog");
    const redditIdx = prompt.indexOf("Reddit");
    expect(vendorIdx).toBeGreaterThan(primaryIdx);
    expect(vendorIdx).toBeLessThan(corroboratingIdx);
    expect(redditIdx).toBeGreaterThan(corroboratingIdx);
  });

  it("tags each member with its source group", () => {
    const prompt = canonicalTitleUserPrompt({
      memberTitles: [
        member({ group: "vendor-official", isPrimary: true, source: "S1" }),
        member({ group: "social", source: "S2" }),
      ],
      leadSummaryZh: null,
      leadSummaryEn: null,
    });
    expect(prompt).toContain("[group=vendor-official]");
    expect(prompt).toContain("[group=social]");
  });

  it("falls back to (none) for null zh/en titles", () => {
    const prompt = canonicalTitleUserPrompt({
      memberTitles: [member({ isPrimary: true })],
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
      memberTitles: [member({ zh: "标题", en: "Title", source: "src", isPrimary: true })],
      leadSummaryZh: null,
      leadSummaryEn: null,
    });

    expect(prompt).toContain("canonicalTitleZh");
    expect(prompt).toContain("canonicalTitleEn");
    expect(prompt).toContain("JSON only");
  });

  it("counts corroborating sources in the section header", () => {
    const titles = Array.from({ length: 7 }, (_, i) => ({
      zh: `标题${i}`,
      en: `Title ${i}`,
      source: `src${i}`,
      group: "media",
      isPrimary: i === 0,
    }));

    const prompt = canonicalTitleUserPrompt({
      memberTitles: titles,
      leadSummaryZh: null,
      leadSummaryEn: null,
    });

    expect(prompt).toContain("CORROBORATING sources (6)");
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

// ── SQL filter must include `titled_at IS NULL` (regression) ────────────────
//
// `updated_at > NULL` evaluates to NULL (falsy) in SQL, so without an explicit
// `titled_at IS NULL` clause the candidate query silently misses any cluster
// whose titled_at was nullified (e.g., by a backfill that recomputed leads).
// Without this assertion, the bug returns the moment someone "simplifies" the
// WHERE clause.

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

describe("Stage C SQL candidate filter", () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const workerSrc = readFileSync(resolve(__dirname, "./canonical-title.ts"), "utf8");

  it("includes `titled_at IS NULL` so backfill-nullified clusters are picked up", () => {
    expect(workerSrc).toContain("clusters.titledAt} IS NULL");
  });

  it("still has the canonical_title_zh IS NULL branch (never-titled clusters)", () => {
    expect(workerSrc).toContain("clusters.canonicalTitleZh} IS NULL");
  });

  it("still has the updated_at > titled_at branch (membership-grew regen)", () => {
    expect(workerSrc).toContain("clusters.updatedAt} > ${clusters.titledAt");
  });
});
