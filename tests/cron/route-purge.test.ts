/**
 * W9b — behavioral test for the conditional feed-cache purge in
 * runCronJsonRoute. Mocks `next/cache` (the same seam feed-cache.test.ts mocks)
 * to record which tags get purged, then drives the REAL runCronJsonRoute with
 * predicate / boolean / absent opts and asserts the aggregate purge fires iff
 * the run reports changed content — and never touches the calendar tag.
 *
 * Mock BEFORE importing the module under test so _route picks up the stub.
 */
import { describe, expect, it, mock } from "bun:test";

const purgedTags: string[] = [];

mock.module("next/cache", () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
  revalidateTag: (tag: string) => {
    purgedTags.push(tag);
  },
}));

const { runCronJsonRoute } = await import("@/app/api/cron/_route");

function authedRequest(): Request {
  return new Request("https://example.test/api/cron/x", {
    headers: { authorization: "Bearer w9b-test-secret" },
  });
}

/** Run the helper with a fixed body + opts; return the tags it purged. */
async function purgedBy(
  body: { kind: string } & Record<string, unknown>,
  opts?: Parameters<typeof runCronJsonRoute>[2],
): Promise<string[]> {
  const previousSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "w9b-test-secret";
  purgedTags.length = 0;
  try {
    await runCronJsonRoute(authedRequest(), () => body, opts);
    return [...purgedTags];
  } finally {
    process.env.CRON_SECRET = previousSecret;
  }
}

describe("runCronJsonRoute — conditional feed purge (W9b)", () => {
  it("purges when a predicate returns true (run changed content)", async () => {
    const tags = await purgedBy(
      { kind: "enrich", enrich: { enriched: 3 } },
      { revalidateFeed: (b) => (b.enrich as { enriched: number }).enriched > 0 },
    );
    expect(tags).toEqual(["feed"]);
  });

  it("does NOT purge when the predicate returns false (idle tick)", async () => {
    const tags = await purgedBy(
      { kind: "enrich", enrich: { enriched: 0 } },
      { revalidateFeed: (b) => (b.enrich as { enriched: number }).enriched > 0 },
    );
    expect(tags).toEqual([]);
  });

  it("purges unconditionally when revalidateFeed === true", async () => {
    const tags = await purgedBy(
      { kind: "cluster" },
      { revalidateFeed: true },
    );
    expect(tags).toEqual(["feed"]);
  });

  it("does NOT purge when no revalidateFeed opt is given", async () => {
    const tags = await purgedBy({ kind: "fetch" });
    expect(tags).toEqual([]);
  });

  it("never purges the calendar tag (it rides its own 6h TTL)", async () => {
    const tags = await purgedBy(
      { kind: "cluster" },
      { revalidateFeed: true },
    );
    expect(tags).not.toContain("feed-calendar");
  });
});
