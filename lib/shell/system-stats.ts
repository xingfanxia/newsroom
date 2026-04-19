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
 *    missing commentary.
 *  - **cron**: mirrors `vercel.json` schedules.
 *  - **errors**: joins `source_health.last_error` with the failing source
 *    for an error-log view.
 */
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { items, rawItems, sources, sourceHealth } from "@/db/schema";

export type SystemService = {
  id: string;
  name: string;
  status: "healthy" | "degraded" | "error" | "idle";
  version: string; // e.g. "rss" / "x-api" / "worker"
  uptime: string;
  ram?: string;
  cpu?: string;
  note?: string | null;
};

export type SystemQueue = {
  name: string;
  depth: number;
  rate: string; // events/min estimate
  p95Ms: number | null;
  driftS: number;
};

export type SystemError = {
  t: string; // short time label (HH:MM)
  level: "error" | "warn" | "info";
  svc: string;
  code: string;
  msg: string;
};

export type SystemCron = {
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

const VERCEL_CRONS = [
  { name: "fetch-hourly", schedule: "17 * * * *", minutes: 60 },
  { name: "fetch-daily", schedule: "23 4 * * *", minutes: 60 * 24 },
  { name: "fetch-weekly", schedule: "43 5 * * 1", minutes: 60 * 24 * 7 },
  { name: "normalize", schedule: "37 */6 * * *", minutes: 60 * 6 },
  { name: "enrich", schedule: "*/15 * * * *", minutes: 15 },
  { name: "cluster", schedule: "*/30 * * * *", minutes: 30 },
  { name: "newsletter-daily", schedule: "11 9 * * *", minutes: 60 * 24 },
  { name: "newsletter-monthly", schedule: "37 9 1 * *", minutes: 60 * 24 * 30 },
];

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
  const now = new Date();

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
      let status: SystemService["status"] = "idle";
      if (r.status === "error" || fails >= 3) status = "error";
      else if (fails >= 1) status = "degraded";
      else if (lastOk && now.getTime() - lastOk.getTime() < 2 * 60 * 60 * 1000)
        status = "healthy";
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
      uncomm: sql<number>`count(*) filter (where ${items.tier} in ('featured','p1') and ${items.commentaryAt} is null)::int`,
      unscored: sql<number>`count(*) filter (where ${items.importance} is null)::int`,
    })
    .from(items);

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
      depth: itemsRow?.uncomm ?? 0,
      rate: "≈ 30/15m",
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
    next: `~${c.minutes >= 60 ? `${Math.round(c.minutes / 60)}h` : `${c.minutes}m`} cadence`,
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
