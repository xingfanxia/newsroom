/**
 * Article body fetcher — uses Jina Reader (https://r.jina.ai) to convert
 * an article URL into clean markdown. Runs BETWEEN normalize and enrich so
 * the LLM sees full article text rather than just the RSS description.
 *
 * Before this stage most items had only title + a 1-2 sentence snippet,
 * producing summaries that literally said "info only from title." Jina
 * returns structured markdown including headings, lists, quotes, and
 * inline links — 10-50x more context for the same item.
 *
 * Strategy:
 *   - Pick items where body_fetched_at IS NULL AND canonical_url IS NOT NULL
 *   - GET https://r.jina.ai/{canonicalUrl} with X-Return-Format: markdown
 *   - On success: write body_md (truncated to MAX_BODY_CHARS), set body_fetched_at
 *   - On failure (4xx/5xx/timeout): still set body_fetched_at so we don't retry
 *     in a tight loop. RSS body remains as the fallback.
 *   - Skip YouTube URLs — task #34 will handle those via transcript fetch
 *
 * Free tier: ~20 RPM anonymous; higher with JINA_API_KEY. Concurrency set
 * conservatively so we stay within the anonymous budget even during big
 * backfills.
 */
import pLimit from "p-limit";
import { and, desc, eq, isNull, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { items } from "@/db/schema";

const JINA_BASE = "https://r.jina.ai/";
const TIMEOUT_MS = 20_000;
const MAX_BODY_CHARS = 12_000; // enough for ~2500 words, fits in enrich + commentary budgets
const MIN_BODY_CHARS = 400; // below this, treat as a bad fetch and keep null
// Jina's anonymous tier 402-rate-limits above ~1 in-flight call. With a
// valid Bearer key (JINA_API_KEY, 65-char `jina_…`) we fan out to 6. If
// the key is missing or malformed we drop to a 1-concurrent + 1.2s-gap
// anonymous flow.
const hasValidKey = (() => {
  const k = process.env.JINA_API_KEY?.trim();
  return !!(k && k.startsWith("jina_") && k.length === 65);
})();
const CONCURRENCY = hasValidKey ? 30 : 1;
const ANON_DELAY_MS = 1200;
const MAX_PER_RUN = hasValidKey ? 300 : 20;

// Matches youtube.com, youtu.be, m.youtube.com, music.youtube.com — anything
// that the youtube-transcript worker should own. Shorts URLs (youtube.com/
// shorts/<id>) parse to youtube.com host, so this catches them naturally.
const YT_HOST_RE = /(^|\.)youtube\.com$|(^|\.)youtu\.be$/i;

export type ArticleBodyReport = {
  candidates: number;
  fetched: number;
  failed: number;
  skipped: number;
  durationMs: number;
  errors: { itemId: number; reason: string }[];
};

export async function runArticleBodyFetch(): Promise<ArticleBodyReport> {
  const started = Date.now();
  const client = db();

  // Order: curated items (featured → p1 → all → excluded → unenriched NULL),
  // then most-recent first. This way the 38 cards readers actually see get
  // bodies (and therefore fresh enrichment) before the 2000+ unseen rows.
  const tierRank = sql`CASE ${items.tier}
    WHEN 'featured' THEN 0
    WHEN 'p1' THEN 1
    WHEN 'all' THEN 2
    WHEN 'excluded' THEN 3
    ELSE 4
  END`;
  const pending = await client
    .select({
      id: items.id,
      canonicalUrl: items.canonicalUrl,
      url: items.url,
    })
    .from(items)
    .where(
      and(
        isNull(items.bodyFetchedAt),
        isNotNull(items.canonicalUrl),
        // YouTube URLs belong to workers/fetcher/youtube-transcript.ts
        // which fetches captions instead of Jina-scraped page HTML.
        sql`${items.canonicalUrl} NOT LIKE '%youtube.com/watch%'`,
        sql`${items.canonicalUrl} NOT LIKE '%youtu.be/%'`,
        sql`${items.canonicalUrl} NOT LIKE '%youtube.com/shorts/%'`,
      ),
    )
    .orderBy(tierRank, desc(items.publishedAt))
    .limit(MAX_PER_RUN);

  if (pending.length === 0) {
    return {
      candidates: 0,
      fetched: 0,
      failed: 0,
      skipped: 0,
      durationMs: Date.now() - started,
      errors: [],
    };
  }

  const limit = pLimit(CONCURRENCY);
  const errors: { itemId: number; reason: string }[] = [];
  let fetched = 0;
  let failed = 0;
  let skipped = 0;

  const postDelay = hasValidKey ? 0 : ANON_DELAY_MS;
  await Promise.allSettled(
    pending.map((item) =>
      limit(async () => {
        const target = item.canonicalUrl || item.url;
        if (!target) {
          await client
            .update(items)
            .set({ bodyFetchedAt: new Date() })
            .where(eq(items.id, item.id));
          skipped++;
          return;
        }
        if (isYouTubeUrl(target)) {
          // Leave bodyFetchedAt NULL — the YouTube transcript worker
          // (workers/fetcher/youtube-transcript.ts) owns these URLs.
          skipped++;
          return;
        }

        const result = await fetchJinaMarkdown(target);
        if (result.kind === "rate_limited") {
          // Don't set bodyFetchedAt — the next cron tick retries.
          failed++;
          errors.push({ itemId: item.id, reason: "rate_limited" });
          return;
        }
        if (result.kind === "error") {
          // Non-retriable (4xx other than 402, DNS error, etc). Mark done
          // so we don't retry forever — the RSS body remains as fallback.
          await client
            .update(items)
            .set({ bodyFetchedAt: new Date() })
            .where(eq(items.id, item.id));
          failed++;
          errors.push({ itemId: item.id, reason: result.reason });
          return;
        }
        const markdown = result.markdown;
        if (markdown.length < MIN_BODY_CHARS) {
          await client
            .update(items)
            .set({ bodyFetchedAt: new Date() })
            .where(eq(items.id, item.id));
          failed++;
          errors.push({ itemId: item.id, reason: "body_too_short" });
          return;
        }

        await client
          .update(items)
          .set({
            bodyMd: markdown.slice(0, MAX_BODY_CHARS),
            bodyFetchedAt: new Date(),
          })
          .where(eq(items.id, item.id));
        fetched++;
        // Spacing on the anonymous tier: after each successful fetch, sleep
        // briefly before releasing the p-limit slot so the next call doesn't
        // trip Jina's per-IP RPM cap.
        if (postDelay > 0) await new Promise((r) => setTimeout(r, postDelay));
      }),
    ),
  );

  return {
    candidates: pending.length,
    fetched,
    failed,
    skipped,
    durationMs: Date.now() - started,
    errors,
  };
}

function isYouTubeUrl(url: string): boolean {
  try {
    return YT_HOST_RE.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

type JinaResult =
  | { kind: "ok"; markdown: string }
  | { kind: "rate_limited" } // 402/429 — retry next tick
  | { kind: "error"; reason: string }; // terminal — keep RSS body

async function fetchJinaMarkdown(url: string): Promise<JinaResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      // Request plain markdown output. Jina still prepends a small header
      // block ("Title: / URL Source: / Markdown Content:") but the rest is
      // clean markdown we can feed directly to the LLM.
      "X-Return-Format": "markdown",
      "User-Agent": "AIRadar/1.0 (+https://newsroom-orpin.vercel.app)",
    };
    // Jina Reader accepts an optional Bearer token for higher quotas. An
    // invalid or exhausted key returns 402 and gives WORSE throughput than
    // the anonymous tier. Only attach the key if it has the documented
    // 65-char `jina_…` shape; otherwise fall back to anonymous.
    const key = process.env.JINA_API_KEY?.trim();
    if (key && key.startsWith("jina_") && key.length === 65) {
      headers["Authorization"] = `Bearer ${key}`;
    }
    const res = await fetch(`${JINA_BASE}${url}`, {
      headers,
      signal: controller.signal,
    });
    // Jina's anonymous tier returns 402 when the IP exceeds its RPM budget
    // (ironically named "Payment Required"; it's a soft rate limit). 429 is
    // the more explicit version. Both should retry, not mark as failed.
    if (res.status === 402 || res.status === 429) {
      if (process.env.DEBUG_JINA) {
        console.warn(`[jina] ${res.status} (rate-limited) for ${url}`);
      }
      return { kind: "rate_limited" };
    }
    if (!res.ok) {
      if (process.env.DEBUG_JINA) {
        console.warn(`[jina] ${res.status} for ${url}`);
      }
      return { kind: "error", reason: `http_${res.status}` };
    }
    const text = await res.text();
    return { kind: "ok", markdown: text.trim() };
  } catch (err) {
    if (process.env.DEBUG_JINA) {
      console.warn(`[jina] error for ${url}:`, err instanceof Error ? err.message : err);
    }
    return { kind: "error", reason: "fetch_error" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ops helper — reset body_fetched_at to NULL for rows that failed the
 * initial fetch so the next cron tick retries them. Call sparingly.
 */
export async function resetFailedFetches(): Promise<number> {
  const client = db();
  const result = await client
    .update(items)
    .set({ bodyFetchedAt: null })
    .where(and(isNotNull(items.bodyFetchedAt), isNull(items.bodyMd)))
    .returning({ id: items.id });
  return result.length;
}

/**
 * Ops helper — reset body_fetched_at for ALL items so a full re-fetch runs.
 * Use only when Jina output format changed or we want to redo everything.
 */
export async function resetAllFetches(): Promise<number> {
  const client = db();
  const result = await client
    .update(items)
    .set({ bodyFetchedAt: null })
    .where(sql`true`)
    .returning({ id: items.id });
  return result.length;
}
