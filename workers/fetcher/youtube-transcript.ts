/**
 * YouTube transcript fetcher — the equivalent of article-body.ts but for
 * YouTube URLs. Long-form AI interviews (Dwarkesh, TheValley101, Lex
 * Fridman) have 1-3 hours of dense content that RSS gives us NOTHING
 * about — title + description only — and article-body.ts can't help
 * because Jina Reader only sees the YouTube page chrome, not the video.
 *
 * Strategy:
 *   - Pick items where canonical_url matches youtube.com/watch|youtu.be
 *     AND body_fetched_at IS NULL
 *   - Try transcripts in this order: zh-Hans → zh-CN → zh → en → default
 *     (first found wins — handles multi-locale channels like TheValley101)
 *   - Concatenate segments, slice to MAX_BODY_CHARS
 *   - On "Transcript is disabled" → mark done, fall back to RSS body
 *   - On network/rate-limit → leave body_fetched_at NULL to retry next tick
 *
 * Scope on long videos: a 2-hour podcast yields ~50K chars of transcript.
 * We can only fit ~12K in the LLM context. Truncation strategy: keep the
 * first 6K + last 5K with a "…" marker in between. Intros + conclusions
 * usually carry more thesis than 60-min rambles in the middle.
 */
import pLimit from "p-limit";
import { YoutubeTranscript } from "youtube-transcript";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { items } from "@/db/schema";

const TIMEOUT_MS = 25_000;
const MAX_BODY_CHARS = 12_000;
const HEAD_CHARS = 6_000;
const TAIL_CHARS = 5_000;
const MIN_TRANSCRIPT_CHARS = 200;
const CONCURRENCY = 6;
const MAX_PER_RUN = 40;

// Chinese channels (硅谷101 / Lex with Chinese guests / etc.) ship transcripts
// in zh-Hans; most English channels ship en or en-US. We cycle through the
// most common languages and take the first one that returns segments.
const LANG_ATTEMPTS = [
  { lang: "zh-Hans" },
  { lang: "zh-CN" },
  { lang: "zh" },
  { lang: "en" },
  { lang: "en-US" },
  {}, // default — usually auto-generated in the video's primary language
];

export type YoutubeTranscriptReport = {
  candidates: number;
  fetched: number;
  disabled: number; // video had no transcript (owner disabled)
  retriable: number; // network/timeout — retry next tick
  errored: number;
  skipped: number; // URL parsed to no video ID
  durationMs: number;
  errors: { itemId: number; reason: string }[];
};

export async function runYoutubeTranscriptFetch(): Promise<YoutubeTranscriptReport> {
  const started = Date.now();
  const client = db();

  // Priority: curated items first, then most recent. Same ranking as the
  // article-body worker so cards readers see get transcripts first.
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
      title: items.title,
    })
    .from(items)
    .where(
      and(
        isNull(items.bodyFetchedAt),
        sql`(
          ${items.canonicalUrl} LIKE '%youtube.com/watch%'
          OR ${items.canonicalUrl} LIKE '%youtu.be/%'
          OR ${items.canonicalUrl} LIKE '%youtube.com/shorts/%'
        )`,
      ),
    )
    .orderBy(tierRank, desc(items.publishedAt))
    .limit(MAX_PER_RUN);

  if (pending.length === 0) {
    return {
      candidates: 0,
      fetched: 0,
      disabled: 0,
      retriable: 0,
      errored: 0,
      skipped: 0,
      durationMs: Date.now() - started,
      errors: [],
    };
  }

  const limit = pLimit(CONCURRENCY);
  const errors: { itemId: number; reason: string }[] = [];
  let fetched = 0;
  let disabled = 0;
  let retriable = 0;
  let errored = 0;
  let skipped = 0;

  await Promise.allSettled(
    pending.map((item) =>
      limit(async () => {
        const videoId = extractVideoId(item.canonicalUrl || item.url);
        if (!videoId) {
          await client
            .update(items)
            .set({ bodyFetchedAt: new Date() })
            .where(eq(items.id, item.id));
          skipped++;
          return;
        }

        const result = await fetchTranscriptWithFallback(videoId);
        if (result.kind === "disabled") {
          // Terminal — video owner disabled transcripts. Don't retry.
          await client
            .update(items)
            .set({ bodyFetchedAt: new Date() })
            .where(eq(items.id, item.id));
          disabled++;
          return;
        }
        if (result.kind === "retriable") {
          // Don't mark — retry next tick.
          retriable++;
          errors.push({ itemId: item.id, reason: result.reason });
          return;
        }
        if (result.kind === "error") {
          await client
            .update(items)
            .set({ bodyFetchedAt: new Date() })
            .where(eq(items.id, item.id));
          errored++;
          errors.push({ itemId: item.id, reason: result.reason });
          return;
        }

        const bodyMd = formatTranscript(result.text, item.title, item.canonicalUrl || item.url);
        if (bodyMd.length < MIN_TRANSCRIPT_CHARS) {
          await client
            .update(items)
            .set({ bodyFetchedAt: new Date() })
            .where(eq(items.id, item.id));
          disabled++;
          return;
        }

        await client
          .update(items)
          .set({
            bodyMd,
            bodyFetchedAt: new Date(),
          })
          .where(eq(items.id, item.id));
        fetched++;
      }),
    ),
  );

  return {
    candidates: pending.length,
    fetched,
    disabled,
    retriable,
    errored,
    skipped,
    durationMs: Date.now() - started,
    errors,
  };
}

// ── URL / video-ID parsing ─────────────────────────────────────

const WATCH_RE = /[?&]v=([A-Za-z0-9_-]{11})/;
const SHORT_RE = /youtu\.be\/([A-Za-z0-9_-]{11})/;
const SHORTS_RE = /\/shorts\/([A-Za-z0-9_-]{11})/;

function extractVideoId(url: string): string | null {
  if (!url) return null;
  return (
    url.match(WATCH_RE)?.[1] ??
    url.match(SHORT_RE)?.[1] ??
    url.match(SHORTS_RE)?.[1] ??
    null
  );
}

// ── Transcript fetch with multi-language fallback ──────────────

type FetchResult =
  | { kind: "ok"; text: string; lang: string }
  | { kind: "disabled" } // video-owner disabled captions — don't retry
  | { kind: "retriable"; reason: string } // network/timeout — retry next tick
  | { kind: "error"; reason: string }; // unknown parse error — mark done

async function fetchTranscriptWithFallback(videoId: string): Promise<FetchResult> {
  for (const opts of LANG_ATTEMPTS) {
    const outcome = await fetchSingleAttempt(videoId, opts);
    if (outcome.kind === "ok") return outcome;
    if (outcome.kind === "disabled") {
      // Some attempts throw "disabled" when the *language* isn't available,
      // others when the *video* has no captions at all. The library doesn't
      // distinguish; try remaining langs, fall through to terminal disabled.
      continue;
    }
    // retriable / error — give up immediately; try again later
    return outcome;
  }
  return { kind: "disabled" };
}

async function fetchSingleAttempt(
  videoId: string,
  opts: { lang?: string },
): Promise<FetchResult> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      // youtube-transcript has no AbortSignal support; rely on its own timeout
      // and wrap in a Promise.race to cap wall time.
      const fetchPromise = YoutubeTranscript.fetchTranscript(
        videoId,
        (opts.lang ? { lang: opts.lang } : undefined) as Parameters<
          typeof YoutubeTranscript.fetchTranscript
        >[1],
      );
      const timeoutPromise = new Promise<never>((_, reject) =>
        controller.signal.addEventListener("abort", () =>
          reject(new Error("timeout")),
        ),
      );
      const segments = (await Promise.race([fetchPromise, timeoutPromise])) as {
        text: string;
        offset: number;
        duration: number;
      }[];
      if (!segments || segments.length === 0) {
        return { kind: "disabled" };
      }
      const text = segments
        .map((s) => s.text.replace(/\s+/g, " ").trim())
        .filter((t) => t.length > 0)
        .join(" ");
      return { kind: "ok", text, lang: opts.lang ?? "default" };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/disabled/i.test(msg) || /no transcript/i.test(msg)) {
      return { kind: "disabled" };
    }
    if (/timeout/i.test(msg) || /ECONN/i.test(msg) || /fetch/i.test(msg)) {
      return { kind: "retriable", reason: msg.slice(0, 120) };
    }
    return { kind: "error", reason: msg.slice(0, 120) };
  }
}

// ── Transcript → bodyMd ─────────────────────────────────────

/**
 * Format a raw transcript into a markdown-ish body that the enrich
 * pipeline can consume. Long videos (>12K chars) get head+tail extraction:
 * keep the first HEAD_CHARS and the last TAIL_CHARS with a "[...]" marker
 * between. Intros usually carry the thesis; conclusions usually carry the
 * takeaway; the long middle often just fleshes out examples.
 */
function formatTranscript(text: string, title: string, url: string): string {
  const header = `# ${title}\n\nSource: ${url}\n\n`;
  const body = text.length <= MAX_BODY_CHARS
    ? text
    : `${text.slice(0, HEAD_CHARS)}\n\n[…transcript continues, middle ${text.length - HEAD_CHARS - TAIL_CHARS} chars omitted…]\n\n${text.slice(-TAIL_CHARS)}`;
  return header + body;
}
