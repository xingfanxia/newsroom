import { randomUUID } from "node:crypto";
import { libsqlClient } from "@/db/client";
import { canonicalJsonBytes } from "@/lib/public-content/canonical";
import { runReceiptSchema } from "@/lib/public-content/contracts";
import { runReceiptKey } from "@/lib/public-content/paths";
import {
  IMMUTABLE_PUBLIC_CACHE_CONTROL,
  type PublisherObjectStore,
} from "./object-store";
import {
  publishIncrementalSnapshot,
  type PublicPublisherReceipt,
} from "./publish";
import { R2PublisherObjectStore } from "./r2-store";
import { LibsqlPublicContentSource } from "./source";
import type { PublicContentPublisherSource } from "./types";

export type PublicPublisherRuntimeOverrides = {
  source?: PublicContentPublisherSource;
  store?: PublisherObjectStore;
  now?: () => number;
  runId?: string;
};

export async function runIncrementalPublicPublisher(
  overrides: PublicPublisherRuntimeOverrides = {},
): Promise<PublicPublisherReceipt> {
  const now = overrides.now ?? Date.now;
  const store = overrides.store ?? publicPublisherStoreFromEnvironment();
  const source =
    overrides.source ?? new LibsqlPublicContentSource(libsqlClient(), { now });
  const receipt = await publishIncrementalSnapshot({
    source,
    store,
    runId: overrides.runId ?? publicPublisherRunId(now()),
    now,
  });
  await persistPublicPublisherReceipt(store, receipt);
  return receipt;
}

export function publicPublisherStoreFromEnvironment(): PublisherObjectStore {
  return R2PublisherObjectStore.fromConfig({
    bucket: requiredEnvironment("R2_BUCKET"),
    accountId: process.env.R2_ACCOUNT_ID,
    endpoint: process.env.R2_ENDPOINT,
    accessKeyId: requiredEnvironment("R2_ACCESS_KEY_ID"),
    secretAccessKey: requiredEnvironment("R2_SECRET_ACCESS_KEY"),
  });
}

export async function persistPublicPublisherReceipt(
  store: PublisherObjectStore,
  receiptValue: unknown,
): Promise<string> {
  const receipt = runReceiptSchema.parse(receiptValue);
  const bytes = canonicalJsonBytes(receipt);
  const key = runReceiptKey(receipt.startedAt.slice(0, 10), receipt.runId);
  await store.putImmutable({
    key,
    bytes,
    mediaType: "application/json",
    cacheControl: IMMUTABLE_PUBLIC_CACHE_CONTROL,
  });
  const stored = await store.readObject(key);
  if (!stored || !equalBytes(stored.bytes, bytes)) {
    throw new Error("public publisher receipt readback mismatch");
  }
  runReceiptSchema.parse(
    JSON.parse(new TextDecoder().decode(stored.bytes)) as unknown,
  );
  return key;
}

export function publicPublisherRunId(nowMs: number): string {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new TypeError("publisher run clock must be a non-negative integer");
  }
  const stamp = new Date(nowMs).toISOString().replaceAll(/[^0-9]/g, "");
  return `p-${stamp}-${randomUUID()}`;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for public publishing`);
  return value;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index])
  );
}
