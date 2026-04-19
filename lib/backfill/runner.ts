/**
 * Backfill runner — dispatches per-source backfill strategies.
 *
 * Two strategies implemented:
 *   - Wayback (rss/atom/rsshub URLs) — fetch historical snapshots of the
 *     feed, parse each, dedup-insert into raw_items.
 *   - ArXiv native (arxiv-cs-*) — use arxiv's /api/query with a submittedDate
 *     range filter; Wayback is no use here because the URL is parameterised.
 *
 * The normalizer + enrich cron will pick up the backfilled raw_items and
 * promote them to items on the next tick — no schema changes needed.
 */
import { parseFeed, type FeedItem } from "@/workers/fetcher/rss";
import { fetchWithRetry } from "@/workers/fetcher/http";
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
  strategy: "wayback" | "arxiv" | "skipped";
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
  if (source.id.startsWith("arxiv-")) {
    return backfillArxiv(source, opts);
  }
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

// ── ArXiv strategy ────────────────────────────────────────────────────────
//
// ArXiv serves a paginated Atom feed with a submittedDate range filter.
// A year of AI papers is ~30k items — we cap to 2000/source (~5-6k for 3
// categories) since our scorer will elide the noise anyway.

async function backfillArxiv(
  source: Source,
  opts: BackfillOptions,
): Promise<BackfillResult> {
  const category = extractArxivCategory(source.url);
  if (!category) {
    return {
      strategy: "skipped",
      reason: `could not parse arxiv category from ${source.url}`,
      sampled: 0,
      parsed: 0,
      withinRange: 0,
      inserted: 0,
      errors: 0,
    };
  }

  const fromStr = arxivDate(opts.from);
  const toStr = arxivDate(opts.to);
  const BASE = "http://export.arxiv.org/api/query";
  const PAGE_SIZE = 500;
  const MAX_RESULTS = 2000;

  let parsed = 0;
  let withinRange = 0;
  let errors = 0;
  let pageCount = 0;
  const pending: FeedItem[] = [];
  const seenExternalIds = new Set<string>();

  for (let start = 0; start < MAX_RESULTS; start += PAGE_SIZE) {
    pageCount++;
    const search = `cat:${category}+AND+submittedDate:[${fromStr}0000+TO+${toStr}2359]`;
    const url = `${BASE}?search_query=${search}&sortBy=submittedDate&sortOrder=descending&start=${start}&max_results=${PAGE_SIZE}`;
    const res = await fetchWithRetry(url, { timeoutMs: 30_000 });
    if (!res.ok) {
      errors++;
      break;
    }
    let items: FeedItem[];
    try {
      items = parseFeed(res.data);
    } catch {
      errors++;
      break;
    }
    parsed += items.length;
    if (items.length === 0) break;

    for (const item of items) {
      if (!inDateWindow(item.publishedAt, opts.from, opts.to)) continue;
      withinRange++;
      if (seenExternalIds.has(item.externalId)) continue;
      seenExternalIds.add(item.externalId);
      pending.push(item);
    }
    if (items.length < PAGE_SIZE) break;
    // arxiv rate limit — sleep 3s between pages per their ToS
    await new Promise((r) => setTimeout(r, 3000));
  }

  const inserted =
    opts.dryRun || pending.length === 0
      ? 0
      : await insertRawItems(source.id, pending);

  return {
    strategy: "arxiv",
    sampled: pageCount,
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

function extractArxivCategory(url: string): string | null {
  // Accepts both legacy `?search_query=cat:cs.AI&…` and new rss URLs
  // like `https://rss.arxiv.org/rss/cs.LG`.
  const rssMatch = url.match(/rss\.arxiv\.org\/rss\/([\w.]+)/);
  if (rssMatch) return rssMatch[1];
  const queryMatch = url.match(/search_query=cat:([\w.]+)/);
  if (queryMatch) return queryMatch[1];
  return null;
}

function arxivDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}
