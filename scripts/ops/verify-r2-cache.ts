import { z } from "zod";
import {
  assertExplicitIntegrationOptIn,
  assertPublicSpendReservation,
  readPublicSpendLedger,
  requireApply,
  requiredFlagValue,
  writePublicEvidenceReceipt,
  type PublicSpendLedger,
} from "./public-evidence";

const cacheObservationSchema = z.strictObject({
  age: z.number().int().nonnegative().nullable(),
  cacheControl: z.string().nullable(),
  cfCacheStatus: z.string().nullable(),
  cors: z.string().nullable(),
  etag: z.string().nullable(),
  status: z.number().int(),
});

export const r2CacheReceiptSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("r2-cache"),
  runId: z.string().min(1),
  capturedAt: z.string().datetime(),
  origin: z.string().url(),
  pointerUrl: z.string().url(),
  immutableUrl: z.string().url(),
  pointer: z.tuple([cacheObservationSchema, cacheObservationSchema]),
  immutable: z.tuple([cacheObservationSchema, cacheObservationSchema]),
  receivedBytes: z.number().int().nonnegative(),
});

export type R2CacheReceipt = z.infer<typeof r2CacheReceiptSchema>;

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export async function verifyR2Cache(options: {
  readonly fetch?: FetchLike;
  readonly immutableUrl: string;
  readonly betweenProbeDelayMs?: number;
  readonly ledger: PublicSpendLedger;
  readonly now?: () => number;
  readonly origin: string;
  readonly pointerUrl: string;
}): Promise<R2CacheReceipt> {
  assertExplicitIntegrationOptIn(options.pointerUrl);
  assertExplicitIntegrationOptIn(options.immutableUrl);
  const pointer = new URL(options.pointerUrl);
  const immutable = new URL(options.immutableUrl);
  if (pointer.origin !== immutable.origin) {
    throw new Error("pointer and immutable probes must share one origin");
  }
  assertPublicSpendReservation(options.ledger, {
    bootstrapSnapshots: 0,
    publicHttpRequests: 4,
    r2ObjectWrites: 0,
    transferBytes: options.ledger.planned.transferBytes,
  });
  const request = options.fetch ?? fetch;
  const betweenProbeDelayMs = options.betweenProbeDelayMs ?? 0;
  if (
    !Number.isSafeInteger(betweenProbeDelayMs) ||
    betweenProbeDelayMs < 0 ||
    betweenProbeDelayMs > 10_000
  ) {
    throw new Error("betweenProbeDelayMs must be 0..10000");
  }
  let receivedBytes = 0;
  const probe = async (url: string) => {
    const response = await request(url, {
      headers: { Origin: options.origin },
      redirect: "error",
    });
    const bytes = (await response.arrayBuffer()).byteLength;
    receivedBytes += bytes;
    if (receivedBytes > options.ledger.planned.transferBytes) {
      throw new Error("spend ledger transferBytes reservation exceeded");
    }
    return {
      age: integerHeader(response.headers.get("age")),
      cacheControl: response.headers.get("cache-control"),
      cfCacheStatus: response.headers.get("cf-cache-status"),
      cors: response.headers.get("access-control-allow-origin"),
      etag: response.headers.get("etag"),
      status: response.status,
    };
  };
  const receipt = r2CacheReceiptSchema.parse({
    schemaVersion: 1,
    kind: "r2-cache",
    runId: options.ledger.runId,
    capturedAt: new Date((options.now ?? Date.now)()).toISOString(),
    origin: options.origin,
    pointerUrl: pointer.toString(),
    immutableUrl: immutable.toString(),
    pointer: await probePair(pointer.toString()),
    immutable: await probePair(immutable.toString()),
    receivedBytes,
  });
  assertR2CacheReceipt(receipt);
  return receipt;

  async function probePair(url: string) {
    const first = await probe(url);
    if (betweenProbeDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, betweenProbeDelayMs));
    }
    return [first, await probe(url)] as const;
  }
}

export function assertR2CacheReceipt(receiptValue: unknown): R2CacheReceipt {
  const receipt = r2CacheReceiptSchema.parse(receiptValue);
  for (const [label, observations] of [
    ["pointer", receipt.pointer],
    ["immutable", receipt.immutable],
  ] as const) {
    for (const observation of observations) {
      if (observation.status !== 200) throw new Error(`${label} probe must return 200`);
      if (!observation.etag) throw new Error(`${label} probe requires ETag`);
      if (observation.cors !== "*" && observation.cors !== receipt.origin) {
        throw new Error(`${label} probe has invalid CORS`);
      }
    }
    if (observations[0].etag !== observations[1].etag) {
      throw new Error(`${label} ETag changed between cache probes`);
    }
    if (observations[1].cfCacheStatus?.toUpperCase() !== "HIT") {
      throw new Error(`${label} second probe must be a Cloudflare HIT`);
    }
    if ((observations[1].age ?? 0) <= 0) {
      throw new Error(`${label} second probe must have positive Age`);
    }
  }
  const pointerControl = receipt.pointer[1].cacheControl ?? "";
  if (/\bimmutable\b/i.test(pointerControl) || effectiveMaxAge(pointerControl) > 60) {
    throw new Error("pointer cache policy is not short-lived");
  }
  const immutableControl = receipt.immutable[1].cacheControl ?? "";
  if (
    !/\bimmutable\b/i.test(immutableControl) ||
    effectiveMaxAge(immutableControl) < 31_536_000
  ) {
    throw new Error("immutable object cache policy is not one year");
  }
  return receipt;
}

function effectiveMaxAge(value: string): number {
  const matches = [...value.matchAll(/(?:^|,)\s*(?:s-maxage|max-age)=(\d+)/gi)];
  if (matches.length === 0) return Number.POSITIVE_INFINITY;
  return Math.max(...matches.map((match) => Number(match[1])));
}

function integerHeader(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  return Number(value);
}

async function main(argv: readonly string[]): Promise<void> {
  requireApply(argv);
  const ledger = readPublicSpendLedger(
    requiredFlagValue(argv, "--spend-ledger"),
  );
  const receipt = await verifyR2Cache({
    betweenProbeDelayMs: 1_100,
    immutableUrl: requiredFlagValue(argv, "--immutable-url"),
    ledger,
    origin: requiredFlagValue(argv, "--origin"),
    pointerUrl: requiredFlagValue(argv, "--pointer-url"),
  });
  writePublicEvidenceReceipt(requiredFlagValue(argv, "--receipt"), receipt);
  console.log(JSON.stringify(receipt, null, 2));
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
