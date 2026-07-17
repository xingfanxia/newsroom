import { describe, expect, it } from "bun:test";
import { readSource } from "@/tests/helpers/source";

const source = readSource("lib/shell/system-stats.ts");
const enrichWorker = readSource("workers/enrich/index.ts");
const scoreWorker = readSource("workers/enrich/score-backfill.ts");
const pendingPredicates = readSource("workers/enrich/pending-predicates.ts");
const schema = readSource("db/schema.ts");
const dbOptimize = readSource("scripts/ops/db-optimize.ts");

describe("admin system stats source wiring", () => {
  it("derives cron schedules from vercel.json", () => {
    expect(source).toContain("@/lib/shell/system-cron");
    expect(source).toContain("systemCronSnapshots(");
    expect(source).toContain("snapshotAt");
    expect(source).not.toContain("@/vercel.json");
    expect(source).not.toContain("VercelCronConfig");
    expect(source).not.toContain("cadenceMinutesFromCron");
    expect(source).not.toContain("function cadenceLabel");
    expect(source).not.toContain("CRON_CADENCE_MINUTES_BY_PATH");
    expect(source).not.toContain('{ name: "newsletter-daily", schedule: "11 9 * * *"');
  });

  it("passes real DB activity signals into the cron table", () => {
    expect(source).toContain("@/lib/time/relative");
    expect(source).toContain("latestFetchForCadences([\"live\", \"hourly\"])");
    expect(source).toContain("latestFetchForCadences([\"daily\"])");
    expect(source).toContain("latestFetchForCadences([\"weekly\"])");
    expect(source).toContain("formatCompactRelativeTime");
    expect(source).toContain("formatElapsedSince");
    expect(source).toContain("latestDate");
    expect(source).toContain("lastNormalizedAt");
    expect(source).toContain("lastBodyFetchedAt");
    expect(source).toContain("lastEnrichedAt");
    expect(source).toContain("lastItemCommentaryAt");
    expect(source).toContain("lastClusterActivityAt");
    expect(source).toContain("lastDailyNewsletterAt");
    expect(source).toContain("lastMonthlyNewsletterAt");
    expect(source).toContain("NO_DURABLE_CRON_ACTIVITY_SIGNAL");
    expect(source).toContain(
      "\"score-backfill\": NO_DURABLE_CRON_ACTIVITY_SIGNAL",
    );
    expect(source).not.toContain("\"score-backfill\": null");
    expect(source).not.toContain("FROM llm_usage");
    expect(source).not.toContain("function ago");
    expect(source).not.toContain("function uptimeFromFirstSuccess");
  });

  it("keeps item commentary queue aligned with the singleton-only worker", () => {
    expect(source).toContain("itemCommentaryPending");
    expect(source).toContain("${items.clusterId} is null");
    expect(source).toContain("coalesce(${clusters.memberCount}, 1) < 2");
    expect(source).toMatch(/systemQueueSnapshot\(\s*"event-commentary"/);
    expect(source).toContain("eventCommentaryPending");
    expect(source).toContain("EVENT_COMMENTARY_CRON_RECENCY_HOURS");
    expect(source).toContain("COALESCE(${clusters.latestMemberAt}, ${clusters.firstSeenAt})");
    expect(source).toContain(
      "${Date.now()} - ${EVENT_COMMENTARY_CRON_RECENCY_HOURS * 3_600_000}",
    );
  });

  it("keeps body-prefetch and enrich queue predicates shared with workers", () => {
    expect(source).toContain("@/lib/urls/media");
    expect(source).toContain("@/workers/enrich/pending-predicates");
    expect(source).toContain("bodyPrefetchPendingSql(");
    expect(source).toContain("enrichClaimableSql(items)");
    expect(source).toContain("bodyPrefetchPending");
    expect(source).toContain("enrichClaimable");
    expect(source).toContain('systemQueueSnapshot("article-body"');
    expect(source).toContain(
      'systemQueueSnapshot("enrich", itemsRow?.enrichClaimable',
    );
    expect(enrichWorker).toContain("enrichClaimableSql(items, { maxAttempts })");
    expect(pendingPredicates).toContain("ENRICH_MAX_ATTEMPTS");
    expect(pendingPredicates).toContain("ENRICH_CLAIM_STALE_MINUTES");
    expect(pendingPredicates).toContain("coalesce(${columns.enrichAttempts}, 0)");
    expect(source).not.toContain("unenriched:");
    expect(source).not.toContain(
      "count(*) filter (where ${items.enrichedAt} is null)::int",
    );
  });

  it("keeps score queue aligned with score-backfill candidates", () => {
    expect(source).toContain("scoreBackfillPendingSql(items)");
    expect(scoreWorker).toContain("scoreBackfillPendingSql(items)");
    expect(source).toContain("scoreBackfillPending");
    expect(source).toContain(
      'systemQueueSnapshot("score", itemsRow?.scoreBackfillPending',
    );
    expect(source).not.toContain(
      "count(*) filter (where ${items.importance} is null)::int",
    );
  });

  it("batches independent system reads instead of serial full-table aggregates", () => {
    expect(source).toContain("await client.batch([");
    expect(source).not.toContain("rawTotal");
    expect(source).not.toContain("profileQuery");
    expect(source).not.toContain("max(${rawItems.normalizedAt})");
    expect(source).not.toContain("max(${items.bodyFetchedAt})");
    expect(source).not.toContain("max(${items.commentaryAt})");
  });

  it("pins every payload-heavy queue/activity probe to its ops index", () => {
    const indexNames = [
      "raw_items_normalized_activity_idx",
      "items_body_prefetch_pending_idx",
      "items_score_backfill_pending_idx",
      "items_body_activity_idx",
      "items_commentary_activity_idx",
      "clusters_event_commentary_pending_idx",
      "clusters_updated_activity_idx",
    ];

    for (const indexName of indexNames) {
      expect(source).toContain(`INDEXED BY ${indexName}`);
      expect(schema).toContain(indexName);
      expect(dbOptimize).toContain(indexName);
    }
  });

  it("keeps queue display metadata in the shared queue contract", () => {
    expect(source).toContain("@/lib/shell/system-queues");
    expect(source).toContain("systemQueueSnapshot(");
    expect(source).not.toContain('rate: "≈ 20-300/15m"');
    expect(source).not.toContain('rate: "≈ 60/15m"');
    expect(source).not.toContain('rate: "≈ 200/30m"');
    expect(source).not.toContain('rate: "≈ 8/30m"');
    expect(source).not.toContain('rate: "≈ 120/15m"');
  });
});
