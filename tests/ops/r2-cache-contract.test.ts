import { describe, expect, test } from "bun:test";
import {
  assertR2CacheReceipt,
  verifyR2Cache,
} from "@/scripts/ops/verify-r2-cache";
import {
  R2_PUBLIC_GOAL_VERSION,
  spendLedgerSchema,
} from "@/scripts/ops/public-evidence";

const origin = "https://news.ax0x.ai";

describe("R2/Cloudflare cache evidence", () => {
  test("requires pointer and immutable MISS/HIT evidence with distinct TTLs", async () => {
    const responses = [
      response("MISS", 0, "public, max-age=60", '"pointer"'),
      response("HIT", 22, "public, max-age=60", '"pointer"'),
      response("MISS", 0, "public, max-age=31536000, immutable", '"object"'),
      response("HIT", 22, "public, max-age=31536000, immutable", '"object"'),
    ];
    const receipt = await verifyR2Cache({
      fetch: async () => responses.shift()!,
      immutableUrl: "http://127.0.0.1:43123/newsroom/v1/objects/sha256/a.json",
      ledger: cacheLedger(),
      now: () => Date.parse("2026-07-14T12:00:00.000Z"),
      origin,
      pointerUrl: "http://127.0.0.1:43123/newsroom/v1/current.json",
    });
    expect(receipt.pointer[1].cfCacheStatus).toBe("HIT");
    expect(receipt.immutable[1].age).toBe(22);
    expect(assertR2CacheReceipt(receipt)).toEqual(receipt);
  });

  test("rejects dynamic/age-zero or collapsed cache policies", () => {
    const valid = {
      schemaVersion: 1,
      kind: "r2-cache",
      runId: "cache-1",
      capturedAt: "2026-07-14T12:00:00.000Z",
      origin,
      pointerUrl: "https://content.example/current.json",
      immutableUrl: "https://content.example/object.json",
      pointer: [
        observation("MISS", 0, "public, max-age=60", '"pointer"'),
        observation("DYNAMIC", 0, "public, max-age=60", '"pointer"'),
      ],
      immutable: [
        observation("MISS", 0, "public, max-age=60", '"object"'),
        observation("HIT", 10, "public, max-age=60", '"object"'),
      ],
      receivedBytes: 4,
    };
    expect(() => assertR2CacheReceipt(valid)).toThrow("Cloudflare HIT");
    valid.pointer[1] = observation("HIT", 10, "public, max-age=31536000, immutable", '"pointer"');
    expect(() => assertR2CacheReceipt(valid)).toThrow("pointer cache policy");
  });
});

function response(status: string, age: number, cacheControl: string, etag: string) {
  return new Response("x", {
    headers: {
      "access-control-allow-origin": origin,
      age: String(age),
      "cache-control": cacheControl,
      "cf-cache-status": status,
      etag,
    },
  });
}

function observation(
  status: string,
  age: number,
  cacheControl: string,
  etag: string,
) {
  return {
    age,
    cacheControl,
    cfCacheStatus: status,
    cors: origin,
    etag,
    status: 200,
  };
}

function cacheLedger() {
  return spendLedgerSchema.parse({
    schemaVersion: 1,
    goalVersion: R2_PUBLIC_GOAL_VERSION,
    runId: "cache-1",
    plannedAt: "2026-07-14T12:00:00.000Z",
    planned: {
      bootstrapSnapshots: 0,
      publicHttpRequests: 4,
      r2ObjectWrites: 0,
      transferBytes: 1_024,
    },
    tursoWindowName: null,
  });
}
