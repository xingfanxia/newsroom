/**
 * Wayback Machine CDX API client for historical RSS/Atom backfill.
 *
 * Strategy: list snapshots for a feed URL in a date range via the CDX API,
 * sample at a configurable cadence (default ~2/week), then fetch each raw
 * snapshot via the `id_` suffix (returns unmodified content, no Wayback
 * chrome). Each snapshot yields 20-30 recent items — sparse sampling plus
 * raw_items dedup is enough to rebuild a full calendar year of history.
 */
import { fetchWithRetry, type FetchResult } from "@/workers/fetcher/http";

export type CdxSnapshot = {
  /** "20260101005029" — UTC, no separators */
  timestamp: string;
  /** Original URL as captured (may differ in case/trailing slash from query) */
  originalUrl: string;
  status: number;
  digest: string;
};

const CDX_ENDPOINT = "https://web.archive.org/cdx/search/cdx";

/**
 * List Wayback snapshots for `url` between `from` and `to` (inclusive).
 *
 * Uses `collapse=timestamp:8` to collapse to one snapshot per UTC day
 * server-side — a feed snapshotted every 5 minutes would otherwise return
 * thousands of rows that all contain the same content.
 */
export async function listSnapshots(
  url: string,
  from: Date,
  to: Date,
  opts: { limit?: number } = {},
): Promise<CdxSnapshot[]> {
  const params = new URLSearchParams({
    url,
    from: formatCdxDate(from),
    to: formatCdxDate(to),
    output: "json",
    collapse: "timestamp:8",
    filter: "statuscode:200",
    limit: String(opts.limit ?? 500),
  });

  const res = await fetchWithRetry(`${CDX_ENDPOINT}?${params}`, {
    timeoutMs: 30_000,
  });
  if (!res.ok) {
    throw new Error(`CDX fetch failed: ${res.error}`);
  }
  return parseCdxResponse(res.data);
}

/** Parse the CDX JSON response — first row is headers, rest are records. */
export function parseCdxResponse(body: string): CdxSnapshot[] {
  const trimmed = body.trim();
  if (!trimmed) return [];
  let rows: unknown;
  try {
    rows = JSON.parse(trimmed);
  } catch {
    throw new Error("CDX response not JSON");
  }
  if (!Array.isArray(rows) || rows.length < 2) return [];

  const [header, ...data] = rows as string[][];
  const tsIdx = header.indexOf("timestamp");
  const urlIdx = header.indexOf("original");
  const statusIdx = header.indexOf("statuscode");
  const digestIdx = header.indexOf("digest");
  if (tsIdx < 0 || urlIdx < 0) {
    throw new Error("CDX response missing expected columns");
  }

  return data.map((row) => ({
    timestamp: row[tsIdx],
    originalUrl: row[urlIdx],
    status: Number(row[statusIdx] ?? 0),
    digest: row[digestIdx] ?? "",
  }));
}

/**
 * Sample snapshots at a cadence (default ~3.5 days — roughly 2/week).
 *
 * Strategy: walk sorted-by-timestamp, keep the first snapshot, then skip
 * every subsequent one until the configured cadence has elapsed. Also
 * dedups by `digest` — if two sampled snapshots share a content hash,
 * only the earlier is kept (the feed hasn't changed).
 */
export function sampleSnapshots(
  snapshots: CdxSnapshot[],
  opts: { cadenceMs?: number } = {},
): CdxSnapshot[] {
  const cadenceMs = opts.cadenceMs ?? 3.5 * 24 * 60 * 60 * 1000;
  if (snapshots.length === 0) return [];

  const sorted = [...snapshots].sort((a, b) =>
    a.timestamp.localeCompare(b.timestamp),
  );
  const kept: CdxSnapshot[] = [];
  const seenDigests = new Set<string>();
  let lastMs = -Infinity;

  for (const snap of sorted) {
    const ms = cdxTimestampToMs(snap.timestamp);
    if (Number.isNaN(ms)) continue;
    if (ms - lastMs < cadenceMs) continue;
    if (snap.digest && seenDigests.has(snap.digest)) continue;
    kept.push(snap);
    seenDigests.add(snap.digest);
    lastMs = ms;
  }
  return kept;
}

/**
 * Fetch the raw content of one Wayback snapshot.
 *
 * The `id_` suffix ("identity") returns the original bytes exactly as
 * archived — no HTML rewrites, no injected toolbar. Without it you get
 * Wayback's wrapper page and the XML parser fails.
 */
export async function fetchSnapshot(
  snapshot: CdxSnapshot,
): Promise<FetchResult<string>> {
  const url = `https://web.archive.org/web/${snapshot.timestamp}id_/${snapshot.originalUrl}`;
  return fetchWithRetry(url, { timeoutMs: 30_000 });
}

function formatCdxDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

/** Convert "20260101005029" -> ms-since-epoch. Returns NaN on malformed input. */
export function cdxTimestampToMs(ts: string): number {
  if (!/^\d{14}$/.test(ts)) return NaN;
  const iso = `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}T${ts.slice(8, 10)}:${ts.slice(10, 12)}:${ts.slice(12, 14)}Z`;
  const d = new Date(iso);
  return d.getTime();
}
