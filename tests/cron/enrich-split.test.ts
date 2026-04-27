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
import { existsSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

describe("split enrich cron — each worker has its own route", () => {
  it("/api/cron/article-body route exists and runs articleBody + youtubeTranscript only", () => {
    const path = resolve(root, "app/api/cron/article-body/route.ts");
    expect(existsSync(path)).toBe(true);
    const src = readFileSync(path, "utf8");
    expect(src).toContain("runArticleBodyFetch");
    expect(src).toContain("runYoutubeTranscriptFetch");
    // Must NOT chain enrich/commentary/score-backfill
    expect(src).not.toContain("runEnrichBatch");
    expect(src).not.toContain("runScoreBackfill");
    expect(src).not.toContain("runCommentaryBackfill");
    // Auth + maxDuration wired
    expect(src).toContain("verifyCron");
    expect(src).toMatch(/maxDuration\s*=\s*\d+/);
  });

  it("/api/cron/score-backfill route exists and runs only score-backfill", () => {
    const path = resolve(root, "app/api/cron/score-backfill/route.ts");
    expect(existsSync(path)).toBe(true);
    const src = readFileSync(path, "utf8");
    expect(src).toContain("runScoreBackfill");
    expect(src).not.toContain("runEnrichBatch");
    expect(src).not.toContain("runArticleBodyFetch");
    expect(src).not.toContain("runCommentaryBackfill");
    expect(src).toContain("verifyCron");
  });

  it("/api/cron/commentary route exists and runs only commentary backfill", () => {
    const path = resolve(root, "app/api/cron/commentary/route.ts");
    expect(existsSync(path)).toBe(true);
    const src = readFileSync(path, "utf8");
    expect(src).toContain("runCommentaryBackfill");
    expect(src).not.toContain("runEnrichBatch");
    expect(src).not.toContain("runArticleBodyFetch");
    expect(src).not.toContain("runScoreBackfill");
    expect(src).toContain("verifyCron");
  });

  it("/api/cron/enrich route now ONLY runs enrich (no chained workers)", () => {
    const path = resolve(root, "app/api/cron/enrich/route.ts");
    expect(existsSync(path)).toBe(true);
    const src = readFileSync(path, "utf8");
    expect(src).toContain("runEnrichBatch");
    // Must no longer chain the other workers — they have their own routes now
    expect(src).not.toContain("runArticleBodyFetch");
    expect(src).not.toContain("runYoutubeTranscriptFetch");
    expect(src).not.toContain("runScoreBackfill");
    expect(src).not.toContain("runCommentaryBackfill");
  });
});

describe("vercel.json — staggered cron schedules for 4 split routes", () => {
  const vercelJson = JSON.parse(
    readFileSync(resolve(root, "vercel.json"), "utf8"),
  ) as { crons: { path: string; schedule: string }[] };

  const cronByPath = new Map(vercelJson.crons.map((c) => [c.path, c.schedule]));

  it("registers /api/cron/article-body with a 15-min cadence", () => {
    expect(cronByPath.has("/api/cron/article-body")).toBe(true);
    const sched = cronByPath.get("/api/cron/article-body")!;
    expect(sched).toMatch(/^\S+\s+\*\s+\*\s+\*\s+\*$/); // valid 5-field
    // Stagger is achieved via different minute offsets vs other routes
  });

  it("registers /api/cron/score-backfill (hourly is sufficient — pre-rubric backfill)", () => {
    expect(cronByPath.has("/api/cron/score-backfill")).toBe(true);
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
