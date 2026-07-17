/**
 * Source-health + queue + error aggregations for /admin/system.
 *
 * Maps real DB signals onto the design-demo's services/queues/cron/errors
 * shape:
 *
 *  - **services**: one row per fetcher source_health entry, grouped into
 *    healthy / degraded / error by `consecutive_failures` + recency of
 *    `last_success_at`. Plus synthetic rows for the pipeline workers
 *    (normalizer, enricher, commentary) derived from recent write activity.
 *  - **queues**: pending normalization depth, body-prefetch candidates,
 *    enrich-claimable items, item rows missing singleton commentary, and
 *    multi-member events missing event-level commentary.
 *  - **cron**: mirrors `vercel.json` schedules.
 *  - **errors**: joins `source_health.last_error` with the failing source
 *    for an error-log view.
 */
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  clusters,
  items,
  newsletters,
  newsletterEmailSends,
  rawItems,
  sources,
  sourceHealth,
} from "@/db/schema";
import { EVENT_COMMENTARY_CRON_RECENCY_HOURS } from "@/lib/events/commentary-window";
import { scoreBackfillPendingSql } from "@/lib/items/score-backfill-predicate";
import {
  NO_DURABLE_CRON_ACTIVITY_SIGNAL,
  systemCronSnapshots,
  type SystemCron,
} from "@/lib/shell/system-cron";
import { systemQueueSnapshot, type SystemQueue } from "@/lib/shell/system-queues";
import {
  formatCompactRelativeTime,
  formatElapsedSince,
  latestDate,
} from "@/lib/time/relative";
import { VISIBLE_ITEM_TIERS } from "@/lib/types";
import { bodyPrefetchPendingSql } from "@/lib/urls/media-sql";
import { enrichClaimableSql } from "@/workers/enrich/pending-predicates";

type SystemService = {
  id: string;
  name: string;
  status: "healthy" | "degraded" | "error" | "idle";
  version: string; // e.g. "rss" / "x-api" / "worker"
  uptime: string;
  ram?: string;
  cpu?: string;
  note?: string | null;
};

type SystemError = {
  t: string; // short time label (HH:MM)
  level: "error" | "warn" | "info";
  svc: string;
  code: string;
  msg: string;
};

export type SystemSnapshot = {
  services: SystemService[];
  queues: SystemQueue[];
  cron: SystemCron[];
  errors: SystemError[];
  counts: {
    healthy: number;
    degraded: number;
    error: number;
    idle: number;
  };
};

/** Raw-SQL `max(<timestamp_ms column>)` comes back as an epoch-ms number
 *  under libSQL (drizzle only applies the timestamp_ms codec to selected
 *  Column objects, not to raw `sql` expressions) — lift it back to a Date
 *  for the cron / relative-time consumers. */
const msToDate = (ms: number | null | undefined): Date | null =>
  ms == null ? null : new Date(ms);

export async function getSystemSnapshot(): Promise<SystemSnapshot> {
  const snapshotAt = new Date();
  const client = db();

  // These metrics are independent, so send them as one libSQL batch instead of
  // paying one HTTP round-trip per query. Payload-heavy tables are explicitly
  // pinned because Turso cannot ANALYZE and therefore has no planner stats.
  const [
    hRows,
    rawPendingRows,
    lastNormalizedRows,
    bodyPrefetchRows,
    enrichRows,
    itemCommentaryRows,
    scoreRows,
    lastBodyRows,
    lastEnrichedRows,
    lastItemCommentaryRows,
    eventCommentaryRows,
    lastClusterRows,
    newsletterRows,
    errRows,
  ] = await client.batch([
    client
      .select({
        sourceId: sources.id,
        nameEn: sources.nameEn,
        kind: sources.kind,
        cadence: sources.cadence,
        enabled: sources.enabled,
        status: sourceHealth.status,
        consecutiveFailures: sourceHealth.consecutiveFailures,
        lastSuccessAt: sourceHealth.lastSuccessAt,
        lastFetchedAt: sourceHealth.lastFetchedAt,
        lastError: sourceHealth.lastError,
        totalItemsCount: sourceHealth.totalItemsCount,
      })
      .from(sources)
      .leftJoin(sourceHealth, eq(sources.id, sourceHealth.sourceId)),
    client
      .select({ rawPending: sql<number>`count(*)` })
      .from(sql`${rawItems} INDEXED BY raw_items_unnormalized_idx`)
      .where(isNull(rawItems.normalizedAt)),
    client
      .select({
        lastNormalizedAt: sql<number | null>`${rawItems.normalizedAt}`,
      })
      .from(sql`${rawItems} INDEXED BY raw_items_normalized_activity_idx`)
      .where(isNotNull(rawItems.normalizedAt))
      .orderBy(desc(rawItems.normalizedAt))
      .limit(1),
    client
      .select({ bodyPrefetchPending: sql<number>`count(*)` })
      .from(sql`${items} INDEXED BY items_body_prefetch_pending_idx`)
      .where(bodyPrefetchPendingSql(items.bodyFetchedAt, items.canonicalUrl)),
    client
      .select({ enrichClaimable: sql<number>`count(*)` })
      .from(sql`${items} INDEXED BY items_unenriched_idx`)
      .where(enrichClaimableSql(items)),
    client
      .select({ itemCommentaryPending: sql<number>`count(*)` })
      .from(sql`${items} INDEXED BY items_commentary_pending_idx`)
      .leftJoin(clusters, eq(items.clusterId, clusters.id))
      .where(
        and(
          inArray(items.tier, VISIBLE_ITEM_TIERS),
          isNull(items.commentaryAt),
          sql`(
            ${items.clusterId} is null
            or coalesce(${clusters.memberCount}, 1) < 2
          )`,
        ),
      ),
    client
      .select({ scoreBackfillPending: sql<number>`count(*)` })
      .from(sql`${items} INDEXED BY items_score_backfill_pending_idx`)
      .where(scoreBackfillPendingSql(items)),
    client
      .select({
        lastBodyFetchedAt: sql<number | null>`${items.bodyFetchedAt}`,
      })
      .from(sql`${items} INDEXED BY items_body_activity_idx`)
      .where(isNotNull(items.bodyFetchedAt))
      .orderBy(desc(items.bodyFetchedAt))
      .limit(1),
    client
      .select({ lastEnrichedAt: sql<number | null>`${items.enrichedAt}` })
      .from(sql`${items} INDEXED BY items_feed_cover_idx`)
      .where(isNotNull(items.enrichedAt))
      .orderBy(desc(items.enrichedAt))
      .limit(1),
    client
      .select({
        lastItemCommentaryAt: sql<number | null>`${items.commentaryAt}`,
      })
      .from(sql`${items} INDEXED BY items_commentary_activity_idx`)
      .where(isNotNull(items.commentaryAt))
      .orderBy(desc(items.commentaryAt))
      .limit(1),
    client
      .select({ eventCommentaryPending: sql<number>`count(*)` })
      .from(
        sql`${clusters} INDEXED BY clusters_event_commentary_pending_idx`,
      )
      .where(
        and(
          inArray(clusters.eventTier, VISIBLE_ITEM_TIERS),
          sql`${clusters.memberCount} >= 2`,
          isNull(clusters.commentaryAt),
          sql`COALESCE(${clusters.latestMemberAt}, ${clusters.firstSeenAt}) >= ${Date.now()} - ${EVENT_COMMENTARY_CRON_RECENCY_HOURS * 3_600_000}`,
        ),
      ),
    client
      .select({
        lastClusterActivityAt: sql<number | null>`${clusters.updatedAt}`,
      })
      .from(sql`${clusters} INDEXED BY clusters_updated_activity_idx`)
      .orderBy(desc(clusters.updatedAt))
      .limit(1),
    client
      .select({
        lastDailyNewsletterAt: sql<number | null>`max(${newsletters.publishedAt}) filter (where ${newsletters.kind} = 'daily')`,
        lastMonthlyNewsletterAt: sql<number | null>`max(${newsletters.publishedAt}) filter (where ${newsletters.kind} = 'monthly')`,
      })
      .from(newsletters),
    client
      .select({
        sourceId: sources.id,
        lastFetchedAt: sourceHealth.lastFetchedAt,
        lastError: sourceHealth.lastError,
        consecutiveFailures: sourceHealth.consecutiveFailures,
        kind: sources.kind,
      })
      .from(sources)
      .innerJoin(sourceHealth, eq(sources.id, sourceHealth.sourceId))
      .where(and(isNotNull(sourceHealth.lastError), eq(sources.enabled, true)))
      .orderBy(desc(sourceHealth.lastFetchedAt))
      .limit(20),
  ] as const);

  const queueRow = {
    rawPending: rawPendingRows[0]?.rawPending ?? 0,
    lastNormalizedAt: lastNormalizedRows[0]?.lastNormalizedAt ?? null,
  };
  const itemsRow = {
    bodyPrefetchPending: bodyPrefetchRows[0]?.bodyPrefetchPending ?? 0,
    enrichClaimable: enrichRows[0]?.enrichClaimable ?? 0,
    itemCommentaryPending:
      itemCommentaryRows[0]?.itemCommentaryPending ?? 0,
    scoreBackfillPending: scoreRows[0]?.scoreBackfillPending ?? 0,
    lastBodyFetchedAt: lastBodyRows[0]?.lastBodyFetchedAt ?? null,
    lastEnrichedAt: lastEnrichedRows[0]?.lastEnrichedAt ?? null,
    lastItemCommentaryAt:
      lastItemCommentaryRows[0]?.lastItemCommentaryAt ?? null,
  };
  const clustersRow = {
    eventCommentaryPending:
      eventCommentaryRows[0]?.eventCommentaryPending ?? 0,
    lastClusterActivityAt:
      lastClusterRows[0]?.lastClusterActivityAt ?? null,
  };
  const newsletterRow = newsletterRows[0];

  const services: SystemService[] = hRows
    .filter((r) => r.enabled)
    .map((r) => {
      const fails = r.consecutiveFailures ?? 0;
      const lastOk = r.lastSuccessAt;
      const lastFetch = r.lastFetchedAt;
      // Classification is cadence-agnostic: "healthy" means the source has
      // fetched successfully at least once and has zero consecutive failures.
      // The previous 2-hour freshness threshold mis-flagged every daily +
      // weekly source as idle even though they were running fine.
      let status: SystemService["status"] = "idle";
      if (r.status === "error" || fails >= 3) status = "error";
      else if (fails >= 1) status = "degraded";
      else if (lastOk) status = "healthy";
      else status = "idle";
      return {
        id: r.sourceId,
        name: r.sourceId,
        status,
        version: r.kind,
        uptime: formatElapsedSince(lastOk, { now: snapshotAt }),
        note:
          status === "error" || status === "degraded"
            ? `${fails} consecutive ${fails === 1 ? "failure" : "failures"} · last ok ${formatCompactRelativeTime(lastOk, { now: snapshotAt, nullLabel: "never" })}`
            : lastFetch
              ? `fetched ${formatCompactRelativeTime(lastFetch, { now: snapshotAt })}`
              : null,
      } satisfies SystemService;
    });

  // Sort: errors first, then degraded, then healthy/idle, then alpha.
  const rank: Record<SystemService["status"], number> = {
    error: 0,
    degraded: 1,
    healthy: 2,
    idle: 3,
  };
  services.sort((a, b) => rank[a.status] - rank[b.status] || a.id.localeCompare(b.id));

  // Annotate-and-continue: newsletter_email_sends ships via a gated
  // operator migration (NLE-7), so a deploy that races it (previews)
  // must degrade this one signal, not kill the whole ops page.
  let lastEmailSendAt: number | null = null;
  try {
    const [sendRow] = await client
      .select({
        lastEmailSendAt: sql<number | null>`max(${newsletterEmailSends.sentAt})`,
      })
      .from(newsletterEmailSends);
    lastEmailSendAt = sendRow?.lastEmailSendAt ?? null;
  } catch (error) {
    console.error(
      "[system-stats] newsletter_email_sends unavailable (migration not applied yet?):",
      error,
    );
  }

  const queues: SystemQueue[] = [
    systemQueueSnapshot("normalize", queueRow?.rawPending ?? 0),
    systemQueueSnapshot("article-body", itemsRow?.bodyPrefetchPending ?? 0),
    systemQueueSnapshot("enrich", itemsRow?.enrichClaimable ?? 0),
    systemQueueSnapshot("commentary", itemsRow?.itemCommentaryPending ?? 0),
    systemQueueSnapshot(
      "event-commentary",
      clustersRow?.eventCommentaryPending ?? 0,
    ),
    systemQueueSnapshot("score", itemsRow?.scoreBackfillPending ?? 0),
  ];

  // --- cron from vercel.json --------------------------------------
  const enabledSourceRows = hRows.filter((r) => r.enabled);
  const latestFetchForCadences = (cadences: string[]) =>
    latestDate(
      ...enabledSourceRows
        .filter((r) => cadences.includes(r.cadence))
        .map((r) => r.lastFetchedAt),
    );
  const cron: SystemCron[] = systemCronSnapshots(
    {
      "fetch-hourly": latestFetchForCadences(["live", "hourly"]),
      "fetch-daily": latestFetchForCadences(["daily"]),
      "fetch-weekly": latestFetchForCadences(["weekly"]),
      normalize: msToDate(queueRow.lastNormalizedAt),
      "article-body": msToDate(itemsRow.lastBodyFetchedAt),
      enrich: msToDate(itemsRow.lastEnrichedAt),
      commentary: msToDate(itemsRow.lastItemCommentaryAt),
      // Score-backfill has no dedicated run-log or `score_updated_at`.
      // Live enrich also emits score LLM usage, so deriving this from
      // `llm_usage.task = score` would create a false activity signal.
      "score-backfill": NO_DURABLE_CRON_ACTIVITY_SIGNAL,
      cluster: msToDate(clustersRow.lastClusterActivityAt),
      "newsletter-daily": msToDate(newsletterRow?.lastDailyNewsletterAt),
      "newsletter-send": msToDate(lastEmailSendAt),
      "newsletter-monthly": msToDate(newsletterRow?.lastMonthlyNewsletterAt),
    },
    snapshotAt,
  );

  const errors: SystemError[] = errRows.map((r) => {
    const fails = r.consecutiveFailures ?? 0;
    const level: SystemError["level"] = fails >= 3 ? "error" : "warn";
    const msg = (r.lastError ?? "").split("\n")[0].slice(0, 160);
    // Try to extract an error code like "http_4xx" or "parse_error" before the colon.
    const codeMatch = msg.match(/^([a-z_0-9]+):/);
    const code = codeMatch ? codeMatch[1] : "error";
    const cleanMsg = codeMatch ? msg.slice(codeMatch[0].length).trim() : msg;
    const t = r.lastFetchedAt
      ? r.lastFetchedAt.toTimeString().slice(0, 5)
      : "—";
    return {
      t,
      level,
      svc: r.sourceId,
      code,
      msg: cleanMsg || `${fails} fails`,
    };
  });

  const counts = services.reduce(
    (acc, s) => {
      acc[s.status]++;
      return acc;
    },
    { healthy: 0, degraded: 0, error: 0, idle: 0 },
  );

  return { services, queues, cron, errors, counts };
}
