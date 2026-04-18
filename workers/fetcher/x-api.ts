/**
 * X (Twitter) API v2 adapter — App-only Bearer auth. Fetches a handle's
 * recent original posts (no retweets / replies). Returns the same FeedItem
 * shape as the RSS adapter so the fetcher dispatcher can stay uniform.
 *
 * Cost discipline:
 * - `since_id` passed from source_health.lastExternalId — each tick only
 *   pays for genuinely new tweets (pay-per-tweet on X's pay-as-you-go).
 * - max_results capped at 20 to keep monthly spend bounded even if a handle
 *   posts continuously.
 * - exclude=retweets,replies filtered server-side, not billed.
 *
 * Original content, not translated:
 * - `text` field is always the author's original text (X never auto-
 *   translates server-side — "translate" is a browser-side feature).
 * - For tweets > 280 chars, X returns the truncated version in `text` and
 *   the full original in `note_tweet.text`. We prefer the latter.
 */
import type { FeedItem } from "./rss";

const API_BASE = "https://api.x.com/2";
const USER_AGENT = "ax-radar/1.0 (+https://news.ax0x.ai)";

/** In-memory cache of handle→userId. Survives warm invocations on Vercel
 *  Fluid Compute; cold starts pay one extra /users/by/username call per
 *  handle (7 accounts * ~150ms ≈ 1s added on first tick after deploy). */
const userIdCache = new Map<string, string>();

export class XApiError extends Error {
  constructor(
    public readonly code:
      | "auth"
      | "not_found"
      | "rate_limited"
      | "server_error"
      | "network"
      | "parse_error",
    message: string,
    public readonly detail?: unknown,
  ) {
    super(message);
    this.name = "XApiError";
  }
}

type XApiResponse<T> = {
  data?: T;
  includes?: Record<string, unknown>;
  meta?: {
    newest_id?: string;
    oldest_id?: string;
    result_count?: number;
    next_token?: string;
  };
  errors?: { title: string; detail: string }[];
};

type XUser = {
  id: string;
  name: string;
  username: string;
};

type XTweet = {
  id: string;
  text: string;
  author_id?: string;
  created_at?: string;
  lang?: string;
  public_metrics?: {
    retweet_count: number;
    reply_count: number;
    like_count: number;
    quote_count: number;
    bookmark_count?: number;
    impression_count?: number;
  };
  referenced_tweets?: { type: "retweeted" | "replied_to" | "quoted"; id: string }[];
  note_tweet?: {
    text: string;
    entities?: unknown;
  };
  entities?: unknown;
  attachments?: unknown;
};

/** Extract the handle from a x.com / twitter.com profile URL. */
export function handleFromUrl(url: string): string {
  const match = url.match(
    /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/(?!home|i\/|search)([A-Za-z0-9_]{1,15})(?:[/?#]|$)/i,
  );
  if (!match) {
    throw new XApiError(
      "parse_error",
      `could not extract handle from URL: ${url}`,
    );
  }
  return match[1];
}

function bearer(): string {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) {
    throw new XApiError(
      "auth",
      "X_BEARER_TOKEN is not set in env; can't call the X API",
    );
  }
  return token;
}

async function xFetch<T>(path: string, params?: URLSearchParams): Promise<T> {
  const url = new URL(API_BASE + path);
  if (params) url.search = params.toString();
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${bearer()}`,
        "User-Agent": USER_AGENT,
      },
    });
  } catch (err) {
    throw new XApiError(
      "network",
      err instanceof Error ? err.message : String(err),
    );
  }
  if (res.status === 401 || res.status === 403) {
    throw new XApiError("auth", `X API ${res.status}`);
  }
  if (res.status === 404) {
    throw new XApiError("not_found", "X API 404");
  }
  if (res.status === 429) {
    const reset = res.headers.get("x-rate-limit-reset");
    throw new XApiError(
      "rate_limited",
      `X API 429 — reset at ${reset ?? "unknown"}`,
    );
  }
  if (res.status >= 500) {
    throw new XApiError("server_error", `X API ${res.status}`);
  }
  if (!res.ok) {
    throw new XApiError("server_error", `X API ${res.status}`);
  }
  return (await res.json()) as T;
}

/** Resolve a handle (e.g. "dotey") to its numeric user ID. Cached. */
export async function resolveUserId(handle: string): Promise<string> {
  const key = handle.toLowerCase();
  const cached = userIdCache.get(key);
  if (cached) return cached;
  const body = await xFetch<XApiResponse<XUser>>(
    `/users/by/username/${encodeURIComponent(handle)}`,
  );
  if (!body.data?.id) {
    throw new XApiError("not_found", `no X user named @${handle}`);
  }
  userIdCache.set(key, body.data.id);
  return body.data.id;
}

export type FetchTimelineOptions = {
  userId: string;
  /** If set, X only returns tweets newer than this ID. Keeps spend low. */
  sinceId?: string | null;
  /** 5-100. Default 20. */
  maxResults?: number;
};

export type TimelineResult = {
  tweets: XTweet[];
  newestId: string | null;
};

/** Pull a user's recent original posts, excluding retweets + replies. */
export async function fetchUserTimeline(
  opts: FetchTimelineOptions,
): Promise<TimelineResult> {
  const params = new URLSearchParams();
  params.set("max_results", String(Math.min(Math.max(opts.maxResults ?? 20, 5), 100)));
  params.set("exclude", "retweets,replies");
  params.set(
    "tweet.fields",
    "id,text,created_at,lang,public_metrics,referenced_tweets,note_tweet,entities,attachments",
  );
  if (opts.sinceId) params.set("since_id", opts.sinceId);

  const body = await xFetch<XApiResponse<XTweet[]>>(
    `/users/${encodeURIComponent(opts.userId)}/tweets`,
    params,
  );
  const tweets = body.data ?? [];
  return {
    tweets,
    newestId: body.meta?.newest_id ?? null,
  };
}

/**
 * Convert an XTweet to the adapter-neutral FeedItem shape. Uses note_tweet
 * text when present (full long-form original content) instead of the
 * truncated `text` field.
 *
 * Returns null for tweets we want to drop pre-persist (replies, retweets —
 * defense in depth beyond the server-side `exclude=`).
 */
export function tweetToFeedItem(
  tweet: XTweet,
  handle: string,
): FeedItem | null {
  // Defense-in-depth: even though we pass `exclude=retweets,replies`, guard
  // against edge cases where the API still returns one.
  const refs = tweet.referenced_tweets ?? [];
  if (
    refs.some((r) => r.type === "retweeted" || r.type === "replied_to")
  ) {
    return null;
  }

  // Prefer note_tweet (long-form) over truncated text.
  const fullText = tweet.note_tweet?.text?.trim() || tweet.text?.trim() || "";
  if (!fullText) return null;

  const publishedAt = tweet.created_at
    ? new Date(tweet.created_at)
    : new Date();

  return {
    externalId: tweet.id,
    url: `https://x.com/${handle}/status/${tweet.id}`,
    title: firstLineTitle(fullText),
    publishedAt,
    // Keep the full tweet payload (including note_tweet and entities) so the
    // normalizer + scorer can access the original text, media, mentions, etc.
    rawPayload: {
      ...tweet,
      // Canonicalized fields for downstream consumers — normalizer reads these.
      body: fullText,
      "content:encoded": fullText,
    },
  };
}

/** First sentence / first 120 chars as a title. Keeps punctuation. */
export function firstLineTitle(text: string): string {
  const firstLine = text.split(/\r?\n/)[0].trim();
  if (firstLine.length <= 120) return firstLine;
  // Break at the last space before 120 chars to avoid mid-word truncation.
  const cut = firstLine.slice(0, 120);
  const lastSpace = cut.lastIndexOf(" ");
  const slice = lastSpace > 60 ? cut.slice(0, lastSpace) : cut;
  return slice + "…";
}

/** One-shot convenience: resolve handle → id → timeline → FeedItem[]. */
export async function fetchTimelineForHandle(input: {
  handle: string;
  sinceId?: string | null;
  maxResults?: number;
}): Promise<{ items: FeedItem[]; newestId: string | null }> {
  const userId = await resolveUserId(input.handle);
  const timeline = await fetchUserTimeline({
    userId,
    sinceId: input.sinceId,
    maxResults: input.maxResults,
  });
  const items: FeedItem[] = [];
  for (const tweet of timeline.tweets) {
    const fi = tweetToFeedItem(tweet, input.handle);
    if (fi) items.push(fi);
  }
  return { items, newestId: timeline.newestId };
}
