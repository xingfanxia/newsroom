import pLimit from "p-limit";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { sources, rawItems, sourceHealth } from "@/db/schema";
import type { Source } from "@/db/schema";
import { fetchWithRetry } from "./http";
import { parseFeed, type FeedItem } from "./rss";

const CONCURRENCY = 8;

export type FetchReport = {
  cadence: string;
  total: number;
  ok: number;
  errored: number;
  newItems: number;
  durationMs: number;
  errors: { sourceId: string; error: string }[];
};

/** Fetch all enabled sources that match the given cadences, in parallel. */
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
  let errored = 0;
  let newItems = 0;
  const errors: { sourceId: string; error: string }[] = [];

  await Promise.allSettled(
    rows.map((source) =>
      limit(async () => {
        try {
          const n = await fetchOneSource(source);
          ok++;
          newItems += n;
        } catch (err) {
          errored++;
          errors.push({
            sourceId: source.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }),
    ),
  );

  return {
    cadence: cadences.join(","),
    total: rows.length,
    ok,
    errored,
    newItems,
    durationMs: Date.now() - started,
    errors,
  };
}

async function fetchOneSource(source: Source): Promise<number> {
  const client = db();

  // Route by kind — for now, rss/atom/rsshub all parse as XML feeds.
  let feedItems: FeedItem[] = [];
  let fetchError: string | null = null;

  if (source.kind === "rss" || source.kind === "atom" || source.kind === "rsshub") {
    const res = await fetchWithRetry<string>(source.url, {
      headers: source.kind === "rsshub" ? { accept: "application/rss+xml" } : undefined,
    });
    if (!res.ok) {
      fetchError = res.error;
    } else {
      try {
        feedItems = parseFeed(res.data);
      } catch (err) {
        fetchError = err instanceof Error ? err.message : String(err);
      }
    }
  } else if (source.kind === "scrape") {
    // M1 stub — wire up to linkedom in next pass. For now, mark pending.
    fetchError = "scrape kind not yet implemented";
  } else if (source.kind === "api") {
    // M1 stub — generic API fetchers are per-source and defer to M2.
    fetchError = "api kind not yet implemented";
  }

  if (fetchError) {
    await client
      .insert(sourceHealth)
      .values({
        sourceId: source.id,
        status: "error",
        lastFetchedAt: new Date(),
        lastError: fetchError,
        consecutiveFailures: 1,
      })
      .onConflictDoUpdate({
        target: sourceHealth.sourceId,
        set: {
          status: "error",
          lastFetchedAt: new Date(),
          lastError: fetchError,
          consecutiveFailures: incrementFailures(),
          updatedAt: new Date(),
        },
      });
    throw new Error(fetchError);
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

  // Mark healthy
  await client
    .insert(sourceHealth)
    .values({
      sourceId: source.id,
      status: "ok",
      lastFetchedAt: new Date(),
      lastSuccessAt: new Date(),
      lastError: null,
      consecutiveFailures: 0,
      lastItemsCount: feedItems.length,
    })
    .onConflictDoUpdate({
      target: sourceHealth.sourceId,
      set: {
        status: "ok",
        lastFetchedAt: new Date(),
        lastSuccessAt: new Date(),
        lastError: null,
        consecutiveFailures: 0,
        lastItemsCount: feedItems.length,
        totalItemsCount: incrementTotal(inserted),
        updatedAt: new Date(),
      },
    });

  return inserted;
}

// drizzle SQL helpers for increment columns
import { sql } from "drizzle-orm";
function incrementFailures() {
  return sql`${sourceHealth.consecutiveFailures} + 1`;
}
function incrementTotal(inserted: number) {
  return sql`${sourceHealth.totalItemsCount} + ${inserted}`;
}
