import { guardUrl, GuardError } from "./guard";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRIES = 2;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5 MB — caps memory + mitigates DoS
const MAX_REDIRECTS = 5;

export type FetchErrorCode =
  | "invalid_url"
  | "invalid_scheme"
  | "empty_host"
  | "blocked_ip_literal"
  | "blocked_resolved_ip"
  | "dns_lookup_failed"
  | "timeout"
  | "network"
  | "too_many_redirects"
  | "response_too_large"
  | "http_4xx"
  | "http_5xx"
  | "parse_error";

export type FetchResult<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; error: FetchErrorCode; detail?: string; status?: number };

/**
 * Retrying fetch with:
 *  - SSRF guard (blocks private/loopback/link-local IPs) pre-fetch and on every redirect hop
 *  - exponential backoff with jitter
 *  - 15s timeout
 *  - 5 MB response cap (streaming byte counter)
 *  - structured error codes (no raw URL / error text leakage to callers)
 */
export async function fetchWithRetry<T = string>(
  url: string,
  opts: {
    headers?: Record<string, string>;
    timeoutMs?: number;
    retries?: number;
    parse?: (body: string) => T;
  } = {},
): Promise<FetchResult<T>> {
  const retries = opts.retries ?? DEFAULT_RETRIES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const parse = opts.parse ?? ((body: string) => body as unknown as T);

  let lastErr: { code: FetchErrorCode; status?: number } = { code: "network" };

  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetchOnce(url, { headers: opts.headers, timeoutMs });
    if (res.ok === true) {
      try {
        return { ok: true, data: parse(res.body), status: res.status };
      } catch {
        return { ok: false, error: "parse_error" };
      }
    }
    lastErr = { code: res.error, status: res.status };

    // Don't retry on permanent errors
    const permanent: FetchErrorCode[] = [
      "invalid_url",
      "invalid_scheme",
      "empty_host",
      "blocked_ip_literal",
      "blocked_resolved_ip",
      "dns_lookup_failed",
      "too_many_redirects",
      "response_too_large",
      "http_4xx",
    ];
    if (permanent.includes(res.error)) break;

    if (attempt < retries) {
      const delay = 600 * 2 ** attempt + Math.random() * 250;
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  return { ok: false, error: lastErr.code, status: lastErr.status };
}

// ── internal: one fetch with manual redirect following & guard on each hop ──

type OnceResult =
  | { ok: true; body: string; status: number }
  | { ok: false; error: FetchErrorCode; status?: number };

async function fetchOnce(
  startUrl: string,
  opts: { headers?: Record<string, string>; timeoutMs: number },
): Promise<OnceResult> {
  let currentUrl = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    try {
      await guardUrl(currentUrl);
    } catch (err) {
      if (err instanceof GuardError)
        return { ok: false, error: err.code as FetchErrorCode };
      return { ok: false, error: "network" };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    let res: Response;
    try {
      res = await fetch(currentUrl, {
        headers: {
          // Browser-ish UA — many RSS endpoints (Meta, Google, DeepLearning.ai,
          // RSSHub-fronted feeds) silently 403 on obvious bot strings.
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 AIRadar/1.0 (+https://newsroom-orpin.vercel.app)",
          accept:
            "application/rss+xml, application/atom+xml, application/feed+json;q=0.95, application/xml;q=0.9, text/xml;q=0.8, text/html;q=0.7, */*;q=0.5",
          "accept-language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
          ...opts.headers,
        },
        signal: controller.signal,
        redirect: "manual",
      });
    } catch (err) {
      clearTimeout(timer);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes("abort"))
        return { ok: false, error: "timeout" };
      return { ok: false, error: "network" };
    }
    clearTimeout(timer);

    // Manual redirect handling
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return { ok: false, error: "network", status: res.status };
      // Resolve relative location against current URL
      try {
        currentUrl = new URL(loc, currentUrl).toString();
      } catch {
        return { ok: false, error: "invalid_url" };
      }
      continue;
    }

    if (res.status >= 400 && res.status < 500) {
      return {
        ok: false,
        error: res.status === 429 ? "http_5xx" : "http_4xx",
        status: res.status,
      };
    }
    if (res.status >= 500) {
      return { ok: false, error: "http_5xx", status: res.status };
    }

    // 2xx: read with a byte cap
    const body = await readCapped(res);
    if (body === null) return { ok: false, error: "response_too_large" };
    return { ok: true, body, status: res.status };
  }
  return { ok: false, error: "too_many_redirects" };
}

async function readCapped(res: Response): Promise<string | null> {
  const reader = res.body?.getReader();
  if (!reader) return await res.text();

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(merged);
}
