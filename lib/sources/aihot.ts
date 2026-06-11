/**
 * AI HOT API client (https://aihot.virxact.com).
 *
 * Anonymous public API — no key. Their nginx blocks `curl/*` UAs with 403,
 * so we send a real-browser UA. Rate limit is 600 req/min per IP, so we
 * throttle ~80ms between paginated calls (mirrors workers/fetcher/x-api.ts).
 *
 * The pagination cursor is opaque — we never decode/parse/increment it.
 * Roundtrip from response → next request only.
 */
import type { FeedItem } from "@/workers/fetcher/rss";

const DEFAULT_BASE_URL = "https://aihot.virxact.com";
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 ax-radar/1.0 (+https://news.ax0x.ai)";
const DEFAULT_TIMEOUT_MS = 15_000;
const PAGE_DELAY_MS = 80;

const ITEM_CATEGORIES = [
  "ai-models",
  "ai-products",
  "industry",
  "tip",
] as const;
type ItemCategory = (typeof ITEM_CATEGORIES)[number];
type AihotApiItemCategory = ItemCategory | "paper";

export type AihotSectionLabel =
  | "模型发布/更新"
  | "产品发布/更新"
  | "行业动态"
  | "论文研究"
  | "技巧与观点";

export class AihotError extends Error {
  constructor(
    public readonly code:
      | "invalid_param"
      | "not_found"
      | "rate_limited"
      | "server_error"
      | "network"
      | "parse_error",
    message: string,
    public readonly detail?: unknown,
  ) {
    super(message);
    this.name = "AihotError";
  }
}

export type AihotItem = {
  id: string;
  title: string;
  /** snake_case in the API response — only this field is snake. */
  title_en: string | null;
  url: string;
  source: string;
  publishedAt: string | null;
  summary: string | null;
  category: AihotApiItemCategory | null;
};

export type AihotItemsResponse = {
  count: number;
  hasNext: boolean;
  nextCursor: string | null;
  items: AihotItem[];
};

export type AihotDailySection = {
  label: AihotSectionLabel;
  items: Array<{
    title: string;
    summary: string;
    sourceUrl: string;
    sourceName: string;
  }>;
};

export type AihotDailyReport = {
  date: string;
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  lead: { title: string; leadParagraph: string } | null;
  sections: AihotDailySection[];
  flashes: Array<{
    title: string;
    sourceName: string;
    sourceUrl: string;
    publishedAt: string;
  }>;
};

export type AihotDailiesIndex = {
  count: number;
  items: Array<{ date: string; generatedAt: string; leadTitle: string | null }>;
};

// ── one HTTP helper, mirrors x-api.ts xFetch shape ───────────────────────

async function aihotFetch<T>(
  path: string,
  params?: URLSearchParams,
): Promise<T> {
  // NB: AIHOT_API_* prefix (NOT AIHOT_*) to disambiguate from the
  // internal task-routing env vars (AIHOT_ENRICH_PROVIDER etc) which use
  // the bare AIHOT_ prefix because the project is internally named "AI hot".
  const base = process.env.AIHOT_API_BASE_URL || DEFAULT_BASE_URL;
  const ua = process.env.AIHOT_API_USER_AGENT || DEFAULT_USER_AGENT;
  const url = new URL(path, base);
  if (params) url.search = params.toString();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": ua, Accept: "application/json" },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    throw new AihotError(
      "network",
      err instanceof Error ? err.message : String(err),
    );
  }
  clearTimeout(timer);

  let body: unknown = null;
  if (res.status !== 204) {
    try {
      body = await res.json();
    } catch {
      // Non-JSON body — leave null and fall through to status mapping.
    }
  }

  const errMsg =
    isRecord(body) && typeof body.error === "string" ? body.error : null;

  if (res.status === 400) {
    throw new AihotError("invalid_param", errMsg ?? `aihot 400`, body);
  }
  if (res.status === 404) {
    throw new AihotError("not_found", errMsg ?? `aihot 404`, body);
  }
  if (res.status === 429) {
    throw new AihotError("rate_limited", `aihot 429 — try again in 60s`, body);
  }
  if (res.status >= 500 || !res.ok) {
    throw new AihotError("server_error", `aihot ${res.status}`, body);
  }
  if (body == null) {
    throw new AihotError("parse_error", `aihot returned empty body`);
  }
  return body as T;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ── public API: items ────────────────────────────────────────────────────

export type FetchItemsParams = {
  mode?: "selected" | "all";
  category?: ItemCategory;
  /** ISO-8601, must not be in the future. Server clamps to last 7 days. */
  since?: string;
  /** Clamped to [1, 100]. */
  take?: number;
  /** Opaque cursor from a prior response's `nextCursor`. Never mutate. */
  cursor?: string;
  q?: string;
};

export async function fetchItems(
  params: FetchItemsParams = {},
): Promise<AihotItemsResponse> {
  const search = new URLSearchParams();

  if (params.mode !== undefined) {
    if (params.mode !== "selected" && params.mode !== "all") {
      throw new AihotError(
        "invalid_param",
        `mode must be 'selected' or 'all', got ${String(params.mode)}`,
      );
    }
    search.set("mode", params.mode);
  }

  if (params.category !== undefined) {
    if (!ITEM_CATEGORIES.includes(params.category)) {
      throw new AihotError(
        "invalid_param",
        `category invalid: ${String(params.category)}`,
      );
    }
    search.set("category", params.category);
  }

  if (params.since !== undefined) {
    const d = new Date(params.since);
    if (Number.isNaN(d.getTime())) {
      throw new AihotError(
        "invalid_param",
        `since must be a valid ISO-8601 date, got ${params.since}`,
      );
    }
    if (d.getTime() > Date.now()) {
      throw new AihotError(
        "invalid_param",
        `since must not be in the future, got ${params.since}`,
      );
    }
    search.set("since", params.since);
  }

  if (params.take !== undefined) {
    search.set("take", String(clampInt(params.take, 1, 100)));
  }
  if (params.cursor !== undefined && params.cursor !== "") {
    search.set("cursor", params.cursor);
  }
  if (params.q !== undefined && params.q !== "") {
    search.set("q", params.q);
  }

  return await aihotFetch<AihotItemsResponse>("/api/public/items", search);
}

// ── public API: dailies ──────────────────────────────────────────────────

const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;

export async function fetchDailyLatest(): Promise<AihotDailyReport> {
  return await aihotFetch<AihotDailyReport>("/api/public/daily");
}

export async function fetchDailyByDate(
  date: string,
): Promise<AihotDailyReport | null> {
  if (!YYYY_MM_DD.test(date)) {
    throw new AihotError(
      "invalid_param",
      `date must match YYYY-MM-DD, got ${date}`,
    );
  }
  // Reject impossible calendar dates (e.g. 2026-13-40).
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) {
    throw new AihotError(
      "invalid_param",
      `date is not a real calendar date: ${date}`,
    );
  }
  try {
    return await aihotFetch<AihotDailyReport>(
      `/api/public/daily/${encodeURIComponent(date)}`,
    );
  } catch (err) {
    if (err instanceof AihotError && err.code === "not_found") return null;
    throw err;
  }
}

export async function fetchDailiesIndex(
  take?: number,
): Promise<AihotDailiesIndex> {
  const search = new URLSearchParams();
  if (take !== undefined) {
    search.set("take", String(clampInt(take, 1, 180)));
  }
  return await aihotFetch<AihotDailiesIndex>(
    "/api/public/dailies",
    search.toString() ? search : undefined,
  );
}

// ── adapter — items → FeedItem (matches rss.ts/x-api.ts shape) ───────────

export function aihotItemToFeedItem(item: AihotItem): FeedItem | null {
  if (!item.id || !item.url) return null;
  const title = item.title?.trim() || "(untitled)";
  const parsed = item.publishedAt ? new Date(item.publishedAt) : null;
  const publishedAt =
    parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
  const summary = item.summary ?? "";
  return {
    externalId: item.id,
    url: item.url,
    title,
    publishedAt,
    rawPayload: {
      ...item,
      // body + content:encoded are required by the normalizer downstream
      // (same trick tweetToFeedItem uses in workers/fetcher/x-api.ts).
      body: summary,
      "content:encoded": summary,
    },
  };
}

// ── pagination convenience ───────────────────────────────────────────────

export type FetchAllItemsParams = FetchItemsParams & {
  /** Hard cap on total items pulled across pages. Default 500. */
  maxItems?: number;
};

export async function fetchAllItems(
  params: FetchAllItemsParams = {},
): Promise<AihotItem[]> {
  const { maxItems = 500, ...rest } = params;
  const cap = Math.max(1, maxItems);
  const out: AihotItem[] = [];
  let cursor: string | undefined = rest.cursor;
  let firstPage = true;

  while (out.length < cap) {
    if (!firstPage) await sleep(PAGE_DELAY_MS);
    const page: AihotItemsResponse = await fetchItems({ ...rest, cursor });
    for (const item of page.items) {
      out.push(item);
      if (out.length >= cap) break;
    }
    if (!page.hasNext || !page.nextCursor || page.items.length === 0) break;
    cursor = page.nextCursor;
    firstPage = false;
  }
  return out;
}

// ── helpers ──────────────────────────────────────────────────────────────

function clampInt(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  const i = Math.trunc(n);
  return i < lo ? lo : i > hi ? hi : i;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
