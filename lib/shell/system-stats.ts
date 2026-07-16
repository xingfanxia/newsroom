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
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
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
import {
  enrichClaimableSql,
  scoreBackfillPendingSql,
} from "@/workers/enrich/pending-predicates";

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

  // --- services from source_health + sources ---------------------
  const hRows = await client
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
    .leftJoin(sourceHealth, eq(sources.id, sourceHealth.sourceId));

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

  // --- queues from items + raw_items ------------------------------
  const [queueRow] = await client
    .select({
      rawPending: sql<number>`count(*) filter (where ${rawItems.normalizedAt} is null)`,
      rawTotal: sql<number>`count(*)`,
      lastNormalizedAt: sql<number | null>`max(${rawItems.normalizedAt})`,
    })
    .from(rawItems);

  const [itemsRow] = await client
    .select({
      bodyPrefetchPending: sql<number>`count(*) filter (where ${bodyPrefetchPendingSql(items.bodyFetchedAt, items.canonicalUrl)})`,
      enrichClaimable: sql<number>`count(*) filter (
        where ${enrichClaimableSql(items)}
      )`,
      itemCommentaryPending: sql<number>`count(*) filter (
        where ${inArray(items.tier, VISIBLE_ITEM_TIERS)}
          and ${items.commentaryAt} is null
          and (
            ${items.clusterId} is null
            or coalesce(${clusters.memberCount}, 1) < 2
          )
      )`,
      scoreBackfillPending: sql<number>`count(*) filter (
        where ${scoreBackfillPendingSql(items)}
      )`,
      lastBodyFetchedAt: sql<number | null>`max(${items.bodyFetchedAt})`,
      lastEnrichedAt: sql<number | null>`max(${items.enrichedAt})`,
      lastItemCommentaryAt: sql<number | null>`max(${items.commentaryAt})`,
    })
    .from(items)
    .leftJoin(clusters, eq(items.clusterId, clusters.id));

  const [clustersRow] = await client
    .select({
      eventCommentaryPending: sql<number>`count(*) filter (
        where ${inArray(clusters.eventTier, VISIBLE_ITEM_TIERS)}
          and ${clusters.memberCount} >= 2
          and ${clusters.commentaryAt} is null
          and COALESCE(${clusters.latestMemberAt}, ${clusters.firstSeenAt}) >= ${Date.now()} - ${EVENT_COMMENTARY_CRON_RECENCY_HOURS * 3_600_000}
      )`,
      lastClusterActivityAt: sql<number | null>`max(${clusters.updatedAt})`,
    })
    .from(clusters);

  const [newsletterRow] = await client
    .select({
      lastDailyNewsletterAt: sql<number | null>`max(${newsletters.publishedAt}) filter (where ${newsletters.kind} = 'daily')`,
      lastMonthlyNewsletterAt: sql<number | null>`max(${newsletters.publishedAt}) filter (where ${newsletters.kind} = 'monthly')`,
    })
    .from(newsletters);

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
      normalize: msToDate(queueRow?.lastNormalizedAt),
      "article-body": msToDate(itemsRow?.lastBodyFetchedAt),
      enrich: msToDate(itemsRow?.lastEnrichedAt),
      commentary: msToDate(itemsRow?.lastItemCommentaryAt),
      // Score-backfill has no dedicated run-log or `score_updated_at`.
      // Live enrich also emits score LLM usage, so deriving this from
      // `llm_usage.task = score` would create a false activity signal.
      "score-backfill": NO_DURABLE_CRON_ACTIVITY_SIGNAL,
      cluster: msToDate(clustersRow?.lastClusterActivityAt),
      "newsletter-daily": msToDate(newsletterRow?.lastDailyNewsletterAt),
      "newsletter-send": msToDate(lastEmailSendAt),
      "newsletter-monthly": msToDate(newsletterRow?.lastMonthlyNewsletterAt),
    },
    snapshotAt,
  );

  // --- errors from source_health.last_error -----------------------
  const errRows = await client
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
    .orderBy(sql`${sourceHealth.lastFetchedAt} desc`)
    .limit(20);

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
