import {
  CURRENT_POINTER_KEY,
  parseObjectKey,
} from "@/lib/public-content/paths";

const RELEASE_MANIFEST_KEY =
  /^newsroom\/v1\/releases\/[a-z0-9][a-z0-9._-]{0,127}\/manifest\.json$/;

export type PublicSnapshotFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type FetchedPublicObject = {
  bytes: Uint8Array;
  etag: string | null;
  contentType: string | null;
};

export class PublicSnapshotFetchError extends Error {
  constructor(readonly reason: "invalid_key" | "network" | "status" | "size") {
    super(`public snapshot fetch failed: ${reason}`);
    this.name = "PublicSnapshotFetchError";
  }
}

export class PublicSnapshotHttpFetcher {
  readonly #baseUrl: URL;
  readonly #fetch: PublicSnapshotFetch;
  readonly #timeoutMs: number;

  constructor(options: {
    baseUrl: string;
    fetch?: PublicSnapshotFetch;
    timeoutMs?: number;
  }) {
    this.#baseUrl = parseBaseUrl(options.baseUrl);
    this.#fetch = options.fetch ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 5_000;
    if (!Number.isSafeInteger(this.#timeoutMs) || this.#timeoutMs < 1) {
      throw new TypeError("snapshot fetch timeout must be a positive integer");
    }
  }

  async read(
    key: string,
    options: { immutable: boolean; maxBytes: number },
  ): Promise<FetchedPublicObject> {
    if (!isAllowedPublicReadKey(key)) {
      throw new PublicSnapshotFetchError("invalid_key");
    }
    if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1) {
      throw new TypeError("snapshot fetch maxBytes must be a positive integer");
    }
    const url = new URL(key, this.#baseUrl);
    if (url.origin !== this.#baseUrl.origin) {
      throw new PublicSnapshotFetchError("invalid_key");
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetch(url, {
        method: "GET",
        redirect: "error",
        signal: controller.signal,
        cache: options.immutable ? "force-cache" : "no-store",
        headers: { accept: "application/json, application/xml, text/markdown" },
      });
      if (
        response.url &&
        (new URL(response.url).origin !== this.#baseUrl.origin ||
          new URL(response.url).pathname !== url.pathname)
      ) {
        throw new PublicSnapshotFetchError("invalid_key");
      }
      if (response.status !== 200) {
        throw new PublicSnapshotFetchError("status");
      }
      const declaredLength = Number(response.headers.get("content-length"));
      if (
        Number.isFinite(declaredLength) &&
        declaredLength > options.maxBytes
      ) {
        throw new PublicSnapshotFetchError("size");
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > options.maxBytes) {
        throw new PublicSnapshotFetchError("size");
      }
      return {
        bytes,
        etag: response.headers.get("etag"),
        contentType: response.headers.get("content-type"),
      };
    } catch (error) {
      if (error instanceof PublicSnapshotFetchError) throw error;
      throw new PublicSnapshotFetchError("network");
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function isAllowedPublicReadKey(key: string): boolean {
  return (
    key === CURRENT_POINTER_KEY ||
    RELEASE_MANIFEST_KEY.test(key) ||
    parseObjectKey(key) !== null
  );
}

function parseBaseUrl(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new TypeError("snapshot base URL must be an HTTPS origin");
  }
  url.pathname = "/";
  return url;
}
