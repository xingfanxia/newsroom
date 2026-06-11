/**
 * Backfill runner — dispatches per-source backfill strategies.
 *
 * Two strategies implemented:
 *   - Wayback (rss/atom/rsshub URLs) — fetch historical snapshots of the
 *     feed, parse each, dedup-insert into raw_items.
 *
 * The normalizer + enrich cron will pick up the backfilled raw_items and
 * promote them to items on the next tick — no schema changes needed.
 */
import { parseFeed, type FeedItem } from "@/workers/fetcher/rss";
import { db } from "@/db/client";
import { rawItems } from "@/db/schema";
import type { Source } from "@/db/schema";
import {
  fetchSnapshot,
  listSnapshots,
  sampleSnapshots,
} from "./wayback";

export type BackfillOptions = {
  from: Date;
  to: Date;
  /** Sampling cadence for Wayback snapshots, in days. Default ~3.5d (~2/week). */
  cadenceDays?: number;
  /** Skip DB inserts; just report what would land. */
  dryRun?: boolean;
};

export type BackfillResult = {
  strategy: "wayback" | "skipped";
  reason?: string;
  sampled: number;
  parsed: number;
  withinRange: number;
  inserted: number;
  errors: number;
};

/** Choose the right strategy for a source, run it, return counts. */
export async function backfillSource(
  source: Source,
  opts: BackfillOptions,
): Promise<BackfillResult> {
  if (source.kind === "rss" || source.kind === "atom" || source.kind === "rsshub") {
    return backfillViaWayback(source, opts);
  }
  return {
    strategy: "skipped",
    reason: `backfill not implemented for kind='${source.kind}' (source '${source.id}')`,
    sampled: 0,
    parsed: 0,
    withinRange: 0,
    inserted: 0,
    errors: 0,
  };
}

// ── Wayback strategy ──────────────────────────────────────────────────────

async function backfillViaWayback(
  source: Source,
  opts: BackfillOptions,
): Promise<BackfillResult> {
  const cadenceMs = (opts.cadenceDays ?? 3.5) * 24 * 60 * 60 * 1000;

  const snapshots = await listSnapshots(source.url, opts.from, opts.to);
  const sampled = sampleSnapshots(snapshots, { cadenceMs });

  let parsed = 0;
  let withinRange = 0;
  let inserted = 0;
  let errors = 0;
  const seenExternalIds = new Set<string>();
  const pending: FeedItem[] = [];

  for (const snap of sampled) {
    const res = await fetchSnapshot(snap);
    if (!res.ok) {
      errors++;
      continue;
    }
    let items: FeedItem[];
    try {
      items = parseFeed(res.data);
    } catch {
      errors++;
      continue;
    }
    parsed += items.length;

    for (const item of items) {
      if (!inDateWindow(item.publishedAt, opts.from, opts.to)) continue;
      withinRange++;
      if (seenExternalIds.has(item.externalId)) continue;
      seenExternalIds.add(item.externalId);
      pending.push(item);
    }
  }

  if (!opts.dryRun && pending.length > 0) {
    inserted = await insertRawItems(source.id, pending);
  }

  return {
    strategy: "wayback",
    sampled: sampled.length,
    parsed,
    withinRange,
    inserted,
    errors,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────

function inDateWindow(pub: Date | null, from: Date, to: Date): boolean {
  if (!pub) return true; // keep items without pubDate — dedup handles rest
  const t = pub.getTime();
  return t >= from.getTime() && t <= to.getTime();
}

export async function insertRawItems(
  sourceId: string,
  items: FeedItem[],
): Promise<number> {
  if (items.length === 0) return 0;
  const client = db();

  // Batch to stay under PG's max param count — 32k params / 6 cols/row = ~5k rows
  const BATCH = 500;
  let inserted = 0;
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH).map((fi) => ({
      sourceId,
      externalId: fi.externalId,
      url: fi.url,
      title: fi.title,
      publishedAt: fi.publishedAt,
      rawPayload: fi.rawPayload as object,
    }));
    const result = await client
      .insert(rawItems)
      .values(batch)
      .onConflictDoNothing({
        target: [rawItems.sourceId, rawItems.externalId],
      })
      .returning({ id: rawItems.id });
    inserted += result.length;
  }
  return inserted;
}
