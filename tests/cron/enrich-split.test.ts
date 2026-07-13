/**
 * Regression: the enrich cron route used to chain 4 workers (article-body
 * + youtube-transcript + enrich + score-backfill + commentary) sequentially
 * inside one Vercel function. Whichever ran first ate the per-function
 * maxDuration budget. Live data showed exactly 1 enrichment per cron tick
 * on average — the function was dying before the second batch had any time.
 *
 * Fix: split into 4 routes so each worker gets its own function budget +
 * staggered cron schedule. Lower concurrency on the high-reasoning workers
 * to match Azure's ~6-7/min cap on `reasoning_effort: "high"` (per
 * `feedback_azure_reasoning_throttle.md`).
 *
 * Pure source-string test — asserts route wiring and vercel.json schedule.
 */
import { describe, expect, it } from "bun:test";
import { existsSync } from "fs";
import { readSource, sourcePath } from "@/tests/helpers/source";
import { cadenceMinutesFromCron } from "@/lib/shell/system-cron";

describe("split enrich cron — each worker has its own route", () => {
  it("/api/cron/article-body route exists and runs articleBody + youtubeTranscript only", () => {
    const path = "app/api/cron/article-body/route.ts";
    expect(existsSync(sourcePath(path))).toBe(true);
    const src = readSource(path);
    expect(src).toContain("runContentPrefetch");
    expect(src).toContain("articleBody: report.articleBody");
    expect(src).toContain("youtubeTranscript: report.youtubeTranscript");
    expect(src).not.toContain("runArticleBodyFetch");
    expect(src).not.toContain("runYoutubeTranscriptFetch");
    // Must NOT chain enrich/commentary/score-backfill
    expect(src).not.toContain("runEnrichBatch");
    expect(src).not.toContain("runScoreBackfill");
    expect(src).not.toContain("runCommentaryBackfill");
    // Shared cron envelope + maxDuration wired
    expect(src).toContain("runCronJsonRoute");
    expect(src).not.toContain("verifyCron(");
    expect(src).toMatch(/maxDuration\s*=\s*\d+/);
  });

  it("/api/cron/score-backfill route exists and runs only score-backfill", () => {
    const path = "app/api/cron/score-backfill/route.ts";
    expect(existsSync(sourcePath(path))).toBe(true);
    const src = readSource(path);
    expect(src).toContain("runScoreBackfill");
    expect(src).not.toContain("runEnrichBatch");
    expect(src).not.toContain("runArticleBodyFetch");
    expect(src).not.toContain("runCommentaryBackfill");
    expect(src).toContain("runCronJsonRoute");
    expect(src).not.toContain("verifyCron(");
  });

  it("/api/cron/commentary route exists and runs only commentary backfill", () => {
    const path = "app/api/cron/commentary/route.ts";
    expect(existsSync(sourcePath(path))).toBe(true);
    const src = readSource(path);
    expect(src).toContain("runCommentaryBackfill");
    expect(src).not.toContain("runEnrichBatch");
    expect(src).not.toContain("runArticleBodyFetch");
    expect(src).not.toContain("runScoreBackfill");
    expect(src).toContain("runCronJsonRoute");
    expect(src).not.toContain("verifyCron(");
  });

  it("/api/cron/enrich route now ONLY runs enrich (no chained workers)", () => {
    const path = "app/api/cron/enrich/route.ts";
    expect(existsSync(sourcePath(path))).toBe(true);
    const src = readSource(path);
    expect(src).toContain("runEnrichBatch");
    // Must no longer chain the other workers — they have their own routes now
    expect(src).not.toContain("runArticleBodyFetch");
    expect(src).not.toContain("runYoutubeTranscriptFetch");
    expect(src).not.toContain("runScoreBackfill");
    expect(src).not.toContain("runCommentaryBackfill");
  });
});

describe("vercel.json — staggered cron schedules for 4 split routes", () => {
  const vercelJson = JSON.parse(readSource("vercel.json")) as {
    crons: { path: string; schedule: string }[];
  };

  const cronByPath = new Map(vercelJson.crons.map((c) => [c.path, c.schedule]));

  it("registers /api/cron/article-body at an hourly-or-finer cadence (W9)", () => {
    expect(cronByPath.has("/api/cron/article-body")).toBe(true);
    const sched = cronByPath.get("/api/cron/article-body")!;
    // Must stay `<min> * * * *` (runs every hour): body-fetch is throughput-
    // critical — on the anonymous Jina tier MAX_PER_RUN=20, so <24 runs/day
    // would starve it below the ~190 items/day ingest. W9 cut it 4×/h → 1×/h
    // (the read win is the index-leak fix, not the cadence). Stagger via minute.
    expect(sched).toMatch(/^\S+\s+\*\s+\*\s+\*\s+\*$/); // valid 5-field, hourly
  });

  it("registers /api/cron/score-backfill at a weekly cadence (W9: drained legacy backfill)", () => {
    // Was hourly; the pre-rubric backfill is drained, so an hourly full-scan of
    // ~20k enriched rows found 0 work every tick. W9 dropped it to weekly.
    // Assert the actual cadence so a revert to hourly is caught (not a tautology).
    expect(cronByPath.has("/api/cron/score-backfill")).toBe(true);
    expect(cadenceMinutesFromCron(cronByPath.get("/api/cron/score-backfill")!)).toBe(
      60 * 24 * 7,
    );
  });

  it("registers /api/cron/commentary", () => {
    expect(cronByPath.has("/api/cron/commentary")).toBe(true);
  });

  it("keeps /api/cron/enrich registered (path didn't change)", () => {
    expect(cronByPath.has("/api/cron/enrich")).toBe(true);
  });

  it("schedules don't all hit the same minute (staggered to avoid pile-up)", () => {
    const minutes = ["/api/cron/article-body", "/api/cron/enrich", "/api/cron/commentary"]
      .map((p) => cronByPath.get(p)!.split(" ")[0]);
    // All minute-fields differ — at least the first three workers stagger.
    const unique = new Set(minutes);
    expect(unique.size).toBe(minutes.length);
  });
});

// Concurrency is intentionally NOT lowered in this PR. Local-backfill data
// (`project_newsroom_state.md`: "Local drain regenerated 267 titles in
// 7.5 min" = 35/min) proves Azure handles the existing concurrency fine
// when the process has wall-clock budget. The cron's 1-completion-per-tick
// rate is a Vercel-function-budget problem, not an Azure-rate problem —
// splitting the routes (above) fixes it directly. Lowering concurrency
// without that split could actually reduce throughput further.
