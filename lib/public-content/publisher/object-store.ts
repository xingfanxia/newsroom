export const IMMUTABLE_PUBLIC_CACHE_CONTROL =
  "public, max-age=31536000, immutable" as const;
export const POINTER_PUBLIC_CACHE_CONTROL =
  "public, max-age=15, s-maxage=30, stale-while-revalidate=300, stale-if-error=86400" as const;

export type PublisherMediaType =
  | "application/json"
  | "application/rss+xml"
  | "application/xml"
  | "text/markdown";

export type StoredPublisherObject = {
  bytes: Uint8Array;
  etag: string;
  mediaType: string | null;
  cacheControl: string | null;
};

export type ImmutablePutInput = {
  key: string;
  bytes: Uint8Array;
  mediaType: PublisherMediaType;
  cacheControl?: string;
};

export type PointerCasInput = {
  key: string;
  expectedEtag: string | null;
  bytes: Uint8Array;
  mediaType: "application/json";
  cacheControl?: string;
};

export interface PublisherObjectStore {
  readObject(key: string): Promise<StoredPublisherObject | null>;
  putImmutable(
    input: ImmutablePutInput,
  ): Promise<{ status: "uploaded" | "reused"; etag: string | null }>;
  compareAndSwapPointer(
    input: PointerCasInput,
  ): Promise<{ status: "committed" | "conflict"; etag: string | null }>;
}
