import pLimit from "p-limit";
import { sql, and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { sources, rawItems, sourceHealth } from "@/db/schema";
import type { Source } from "@/db/schema";
import { fetchWithRetry, type FetchErrorCode } from "./http";
import { parseFeed, type FeedItem } from "./rss";

const CONCURRENCY = 8;

// Kinds we can fetch in M1. Other kinds are kept in the catalog but skipped
// (pending implementation) so they appear in source_health without polluting errors.
const SUPPORTED_KINDS = ["rss", "atom", "rsshub"] as const;
type SupportedKind = (typeof SUPPORTED_KINDS)[number];
function isSupported(k: string): k is SupportedKind {
  return (SUPPORTED_KINDS as readonly string[]).includes(k);
}

export type FetchReport = {
  cadence: string;
  total: number;
  ok: number;
  pending: number;
  errored: number;
  newItems: number;
  durationMs: number;
  errors: { sourceId: string; code: FetchErrorCode | "unknown" }[];
};

/** Fetch all enabled sources matching the given cadences, in parallel. */
export async function runFetchBucket(
  cadences: ("live" | "hourly" | "daily" | "weekly")[],
): Promise<FetchReport> {
  const started = Date.now();
  const client = db();

  const rows = await client
    .select()
    .from(sources)
    .where(and(inArray(sources.cadence, cadences), eq(sources.enabled, true)));

  const limit = pLimit(CONCURRENCY);
  let ok = 0;
  let pending = 0;
  let errored = 0;
  let newItems = 0;
  const errors: { sourceId: string; code: FetchErrorCode | "unknown" }[] = [];

  await Promise.allSettled(
    rows.map((source) =>
      limit(async () => {
        try {
          const outcome = await fetchOneSource(source);
          if (outcome.kind === "ok") {
            ok++;
            newItems += outcome.newItems;
          } else if (outcome.kind === "pending") {
            pending++;
          } else {
            errored++;
            errors.push({ sourceId: source.id, code: outcome.code });
          }
        } catch {
          errored++;
          errors.push({ sourceId: source.id, code: "unknown" });
        }
      }),
    ),
  );

  return {
    cadence: cadences.join(","),
    total: rows.length,
    ok,
    pending,
    errored,
    newItems,
    durationMs: Date.now() - started,
    errors,
  };
}

type Outcome =
  | { kind: "ok"; newItems: number }
  | { kind: "pending" }
  | { kind: "error"; code: FetchErrorCode | "unknown"; detail: string };

async function fetchOneSource(source: Source): Promise<Outcome> {
  const client = db();

  // Short-circuit unsupported kinds: leave status="pending" so the admin
  // can see which sources aren't yet implemented without triggering alerts.
  if (!isSupported(source.kind)) {
    await client
      .insert(sourceHealth)
      .values({
        sourceId: source.id,
        status: "pending",
        lastFetchedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: sourceHealth.sourceId,
        set: {
          status: "pending",
          lastFetchedAt: new Date(),
          updatedAt: new Date(),
        },
      });
    return { kind: "pending" };
  }

  // Supported kinds all parse as XML feeds for now.
  const url = resolveSourceUrl(source);
  const res = await fetchWithRetry<string>(url);
  if (!res.ok) {
    await markError(source.id, res.error, res.error);
    return { kind: "error", code: res.error, detail: res.error };
  }

  let feedItems: FeedItem[];
  try {
    feedItems = parseFeed(res.data);
  } catch {
    await markError(source.id, "parse_error", "parse_error");
    return { kind: "error", code: "parse_error", detail: "parse_error" };
  }

  // Insert raw rows (dedup by unique index on (source_id, external_id))
  let inserted = 0;
  if (feedItems.length > 0) {
    const values = feedItems.map((fi) => ({
      sourceId: source.id,
      externalId: fi.externalId,
      url: fi.url,
      title: fi.title,
      publishedAt: fi.publishedAt,
      rawPayload: fi.rawPayload as object,
    }));
    const result = await client
      .insert(rawItems)
      .values(values)
      .onConflictDoNothing({
        target: [rawItems.sourceId, rawItems.externalId],
      })
      .returning({ id: rawItems.id });
    inserted = result.length;
  }

  await markOk(source.id, feedItems.length, inserted);
  return { kind: "ok", newItems: inserted };
}

async function markOk(
  sourceId: string,
  seenCount: number,
  insertedCount: number,
) {
  const client = db();
  await client
    .insert(sourceHealth)
    .values({
      sourceId,
      status: "ok",
      lastFetchedAt: new Date(),
      lastSuccessAt: new Date(),
      lastError: null,
      consecutiveFailures: 0,
      lastItemsCount: seenCount,
      totalItemsCount: insertedCount,
    })
    .onConflictDoUpdate({
      target: sourceHealth.sourceId,
      set: {
        status: "ok",
        lastFetchedAt: new Date(),
        lastSuccessAt: new Date(),
        lastError: null,
        consecutiveFailures: 0,
        lastItemsCount: seenCount,
        totalItemsCount: sql`${sourceHealth.totalItemsCount} + ${insertedCount}`,
        updatedAt: new Date(),
      },
    });
}

/**
 * Resolves the URL to fetch, applying the RSSHub mirror if configured.
 * The free rsshub.app instance rate-limits heavily; swap to a self-hosted
 * or community mirror via RSSHUB_BASE_URL (e.g. https://rsshub.rssforever.com).
 */
function resolveSourceUrl(source: Source): string {
  if (source.kind !== "rsshub") return source.url;
  const base = process.env.RSSHUB_BASE_URL?.replace(/\/+$/, "");
  if (!base) return source.url;
  try {
    const parsed = new URL(source.url);
    const baseParsed = new URL(base);
    parsed.protocol = baseParsed.protocol;
    parsed.host = baseParsed.host;
    parsed.port = baseParsed.port;
    // Preserve path + query; allow base to include a path prefix.
    if (baseParsed.pathname && baseParsed.pathname !== "/") {
      parsed.pathname = baseParsed.pathname.replace(/\/+$/, "") + parsed.pathname;
    }
    return parsed.toString();
  } catch {
    return source.url;
  }
}

async function markError(
  sourceId: string,
  errorCode: FetchErrorCode,
  /** Detail is stored server-side but never returned from cron routes. */
  detail: string,
) {
  const client = db();
  await client
    .insert(sourceHealth)
    .values({
      sourceId,
      status: "error",
      lastFetchedAt: new Date(),
      lastError: `${errorCode}: ${detail}`,
      consecutiveFailures: 1,
    })
    .onConflictDoUpdate({
      target: sourceHealth.sourceId,
      set: {
        status: "error",
        lastFetchedAt: new Date(),
        lastError: `${errorCode}: ${detail}`,
        consecutiveFailures: sql`${sourceHealth.consecutiveFailures} + 1`,
        updatedAt: new Date(),
      },
    });
}
