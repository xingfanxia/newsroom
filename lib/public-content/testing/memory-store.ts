import type { PublicSnapshotFetch } from "@/lib/public-content/reader/fetch-object";

type MemoryObject = {
  bytes: Uint8Array;
  contentType: string;
  etag: string;
  status: number;
};

export type MemoryPublicSnapshotRequest = {
  key: string;
  cache: RequestCache | undefined;
  redirect: RequestRedirect | undefined;
};

export class MemoryPublicSnapshotHttp {
  readonly baseUrl: string;
  readonly requests: MemoryPublicSnapshotRequest[] = [];
  readonly #objects = new Map<string, MemoryObject>();
  readonly #hanging = new Set<string>();

  constructor(baseUrl = "https://public-content.test") {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:" || url.pathname !== "/") {
      throw new TypeError("memory snapshot base URL must be an HTTPS origin");
    }
    this.baseUrl = url.origin;
  }

  readonly fetch: PublicSnapshotFetch = async (input, init) => {
    const url = requestUrl(input);
    if (url.origin !== this.baseUrl) {
      throw new Error(`unexpected memory snapshot origin: ${url.origin}`);
    }
    const key = url.pathname.slice(1);
    this.requests.push({ key, cache: init?.cache, redirect: init?.redirect });
    if (this.#hanging.has(key)) {
      await waitForAbort(init?.signal);
    }
    const object = this.#objects.get(key);
    const response = object
      ? new Response(object.bytes.slice(), {
          status: object.status,
          headers: {
            "content-length": String(object.bytes.byteLength),
            "content-type": object.contentType,
            etag: object.etag,
          },
        })
      : new Response("not found", { status: 404 });
    Object.defineProperty(response, "url", {
      configurable: true,
      value: url.toString(),
    });
    return response;
  };

  put(
    key: string,
    bytes: Uint8Array,
    options: { contentType?: string; etag?: string; status?: number } = {},
  ): void {
    this.#objects.set(key, {
      bytes: bytes.slice(),
      contentType: options.contentType ?? "application/json",
      etag: options.etag ?? `"memory-${this.#objects.size + 1}"`,
      status: options.status ?? 200,
    });
    this.#hanging.delete(key);
  }

  delete(key: string): void {
    this.#objects.delete(key);
    this.#hanging.delete(key);
  }

  setStatus(key: string, status: number): void {
    const object = this.#objects.get(key);
    if (!object) throw new Error(`cannot set status for missing object: ${key}`);
    object.status = status;
  }

  hang(key: string): void {
    this.#hanging.add(key);
  }

  clearRequests(): void {
    this.requests.length = 0;
  }

  requestCount(key: string): number {
    return this.requests.filter((request) => request.key === key).length;
  }
}

function requestUrl(input: string | URL | Request): URL {
  if (input instanceof Request) return new URL(input.url);
  return new URL(input.toString());
}

async function waitForAbort(signal: AbortSignal | null | undefined): Promise<never> {
  if (!signal) return new Promise<never>(() => undefined);
  if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  return new Promise<never>((_resolve, reject) => {
    signal.addEventListener(
      "abort",
      () => reject(signal.reason ?? new DOMException("Aborted", "AbortError")),
      { once: true },
    );
  });
}
