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
 *  - **queues**: pending normalization depth, unenriched items, item rows
 *    missing singleton commentary, and multi-member events missing
 *    event-level commentary.
 *  - **cron**: mirrors `vercel.json` schedules.
 *  - **errors**: joins `source_health.last_error` with the failing source
 *    for an error-log view.
 */
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clusters, items, rawItems, sources, sourceHealth } from "@/db/schema";
import { EVENT_COMMENTARY_CRON_RECENCY_HOURS } from "@/lib/events/commentary-window";
import vercelConfig from "@/vercel.json";

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

type SystemQueue = {
  name: string;
  depth: number;
  rate: string; // events/min estimate
  p95Ms: number | null;
  driftS: number;
};

type SystemError = {
  t: string; // short time label (HH:MM)
  level: "error" | "warn" | "info";
  svc: string;
  code: string;
  msg: string;
};

type SystemCron = {
  name: string;
  schedule: string;
  next: string; // relative eg "in 23m"
  last: string; // relative eg "7m ago"
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

type VercelCronConfig = {
  path: string;
  schedule: string;
};

const VERCEL_CRONS = ((vercelConfig as { crons?: VercelCronConfig[] }).crons ?? [])
  .map((c) => ({
    name: c.path.replace(/^\/api\/cron\//, ""),
    schedule: c.schedule,
    minutes: cadenceMinutesFromCron(c.schedule),
  }));

export function cadenceMinutesFromCron(schedule: string): number | null {
  const [minute, hour, dayOfMonth, month, dayOfWeek, extra] = schedule.trim().split(/\s+/);
  if (!minute || !hour || !dayOfMonth || !month || !dayOfWeek || extra) {
    return null;
  }

  if (month !== "*") return null;

  const minuteInterval = evenlySpacedInterval(minute, 60);
  if (minuteInterval !== null && hour === "*" && dayOfMonth === "*" && dayOfWeek === "*") {
    return minuteInterval;
  }

  if (!isSingleNumber(minute)) return null;

  if (hour === "*" && dayOfMonth === "*" && dayOfWeek === "*") return 60;

  const hourStep = stepEvery(hour);
  if (hourStep !== null && dayOfMonth === "*" && dayOfWeek === "*") {
    return hourStep * 60;
  }

  if (!isSingleNumber(hour)) return null;
  if (dayOfMonth === "*" && dayOfWeek === "*") return 60 * 24;
  if (dayOfMonth === "*" && isSingleNumber(dayOfWeek)) return 60 * 24 * 7;
  if (dayOfMonth === "1" && dayOfWeek === "*") return 60 * 24 * 30;

  return null;
}

function cadenceLabel(minutes: number | null): string {
  if (!minutes) return "configured";
  if (minutes >= 60) return `${Math.round(minutes / 60)}h`;
  return `${minutes}m`;
}

function evenlySpacedInterval(field: string, cycle: number): number | null {
  const values = field.split(",").map((v) => Number(v));
  if (values.length < 2 || values.some((v) => !Number.isInteger(v))) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const intervals = sorted.map((value, idx) => {
    const next = sorted[(idx + 1) % sorted.length];
    return ((next ?? 0) - value + cycle) % cycle;
  });
  const [first, ...rest] = intervals;
  if (!first || rest.some((interval) => interval !== first)) return null;
  return first;
}

function isSingleNumber(field: string): boolean {
  return /^\d+$/.test(field);
}

function stepEvery(field: string): number | null {
  const match = field.match(/^\*\/(\d+)$/);
  if (!match) return null;
  const step = Number(match[1]);
  return Number.isInteger(step) && step > 0 ? step : null;
}

function ago(date: Date | null): string {
  if (!date) return "never";
  const ms = Date.now() - date.getTime();
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

function uptimeFromFirstSuccess(first: Date | null): string {
  if (!first) return "—";
  const ms = Date.now() - first.getTime();
  const d = Math.floor(ms / (1000 * 60 * 60 * 24));
  const h = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  if (d > 0) return `${d}d ${h}h`;
  return `${h}h`;
}

export async function getSystemSnapshot(): Promise<SystemSnapshot> {
  const client = db();

  // --- services from source_health + sources ---------------------
  const hRows = await client
    .select({
      sourceId: sources.id,
      nameEn: sources.nameEn,
      kind: sources.kind,
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
        uptime: uptimeFromFirstSuccess(lastOk),
        note:
          status === "error" || status === "degraded"
            ? `${fails} consecutive ${fails === 1 ? "failure" : "failures"} · last ok ${ago(lastOk)}`
            : lastFetch
              ? `fetched ${ago(lastFetch)}`
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
      rawPending: sql<number>`count(*) filter (where ${rawItems.normalizedAt} is null)::int`,
      rawTotal: sql<number>`count(*)::int`,
    })
    .from(rawItems);

  const [itemsRow] = await client
    .select({
      unenriched: sql<number>`count(*) filter (where ${items.enrichedAt} is null)::int`,
      itemCommentaryPending: sql<number>`count(*) filter (
        where ${items.tier} in ('featured','p1','all')
          and ${items.commentaryAt} is null
          and (
            ${items.clusterId} is null
            or coalesce(${clusters.memberCount}, 1) < 2
          )
      )::int`,
      unscored: sql<number>`count(*) filter (where ${items.importance} is null)::int`,
    })
    .from(items)
    .leftJoin(clusters, eq(items.clusterId, clusters.id));

  const [clustersRow] = await client
    .select({
      eventCommentaryPending: sql<number>`count(*) filter (
        where ${clusters.eventTier} in ('featured','p1','all')
          and ${clusters.memberCount} >= 2
          and ${clusters.commentaryAt} is null
          and COALESCE(${clusters.latestMemberAt}, ${clusters.firstSeenAt}) >= now() - make_interval(hours => ${EVENT_COMMENTARY_CRON_RECENCY_HOURS})
      )::int`,
    })
    .from(clusters);

  const queues: SystemQueue[] = [
    {
      name: "normalize",
      depth: queueRow?.rawPending ?? 0,
      rate: "≈ 280/hr",
      p95Ms: null,
      driftS: 0,
    },
    {
      name: "enrich",
      depth: itemsRow?.unenriched ?? 0,
      rate: "≈ 60/15m",
      p95Ms: null,
      driftS: 0,
    },
    {
      name: "commentary",
      depth: itemsRow?.itemCommentaryPending ?? 0,
      rate: "≈ 200/30m",
      p95Ms: null,
      driftS: 0,
    },
    {
      name: "event-commentary",
      depth: clustersRow?.eventCommentaryPending ?? 0,
      rate: "≈ 8/30m",
      p95Ms: null,
      driftS: 0,
    },
    {
      name: "score",
      depth: itemsRow?.unscored ?? 0,
      rate: "≈ 120/15m",
      p95Ms: null,
      driftS: 0,
    },
  ];

  // --- cron from vercel.json --------------------------------------
  const cron: SystemCron[] = VERCEL_CRONS.map((c) => ({
    name: c.name,
    schedule: c.schedule,
    next: `~${cadenceLabel(c.minutes)} cadence`,
    last: "—",
  }));

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
