const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRIES = 2;

export type FetchResult<T> = {
  ok: true;
  data: T;
  status: number;
} | {
  ok: false;
  error: string;
  status?: number;
};

/**
 * Retrying fetch with exponential backoff and a deadline.
 * Returns a structured result instead of throwing — callers can inspect ok/error.
 */
export async function fetchWithRetry<T = string>(
  url: string,
  opts: {
    headers?: Record<string, string>;
    timeoutMs?: number;
    retries?: number;
    parse?: (res: Response) => Promise<T>;
  } = {},
): Promise<FetchResult<T>> {
  const retries = opts.retries ?? DEFAULT_RETRIES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const parse =
    opts.parse ??
    (async (r: Response) => (await r.text()) as unknown as T);

  let lastErr: { msg: string; status?: number } = { msg: "unknown" };
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: {
          "user-agent": "AI-HOT-fetcher/1.0 (+https://newsroom-orpin.vercel.app)",
          accept:
            "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5",
          ...opts.headers,
        },
        signal: controller.signal,
        redirect: "follow",
      });
      clearTimeout(timer);
      if (!res.ok) {
        lastErr = { msg: `http ${res.status}`, status: res.status };
        // 429 / 5xx → retry. 4xx (other) → give up fast.
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          return { ok: false, error: lastErr.msg, status: res.status };
        }
      } else {
        const data = await parse(res);
        return { ok: true, data, status: res.status };
      }
    } catch (err) {
      clearTimeout(timer);
      lastErr = {
        msg: err instanceof Error ? err.message : String(err),
      };
    }

    if (attempt < retries) {
      const delay = 600 * 2 ** attempt + Math.random() * 250;
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  return { ok: false, error: lastErr.msg, status: lastErr.status };
}
