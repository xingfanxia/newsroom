import { describe, expect, test } from "bun:test";
import { GET as publicFeedGet } from "@/app/api/public/feed/route";
import { assertProductionIntegrationOptIn } from "@/scripts/verification/run-hermetic-tests";
import { assertProductionPrecondition } from "@/tests/integration/production/preconditions";

assertProductionIntegrationOptIn();

function req(path: string): Request {
  return new Request(`http://localhost${path}`);
}

describe("/api/public/feed", () => {
  test("total is stable across page sizes", async () => {
    const first = await publicFeedGet(
      req("/api/public/feed?tier=all&limit=1"),
    );
    const wider = await publicFeedGet(
      req("/api/public/feed?tier=all&limit=2"),
    );
    expect(first.status).toBe(200);
    expect(wider.status).toBe(200);

    const firstBody = await first.json();
    const widerBody = await wider.json();
    assertProductionPrecondition(
      widerBody.items.length >= 2,
      "public feed must expose at least two rows to prove pagination totals",
    );

    expect(firstBody.items.length).toBe(1);
    expect(widerBody.items.length).toBe(2);
    expect(firstBody.total).toBe(widerBody.total);
    expect(firstBody.total).toBeGreaterThan(firstBody.items.length);
  });
});
