import { describe, expect, test } from "bun:test";
import { GET as publicSearchGet } from "@/app/api/public/search/route";
import { assertProductionIntegrationOptIn } from "@/scripts/verification/run-hermetic-tests";
import { assertProductionPrecondition } from "@/tests/integration/production/preconditions";

assertProductionIntegrationOptIn();

function req(path: string): Request {
  return new Request(`http://localhost${path}`);
}

describe("/api/public/search", () => {
  test("lexical total is stable across page sizes", async () => {
    const first = await publicSearchGet(
      req("/api/public/search?q=agent&mode=lexical&limit=1"),
    );
    const wider = await publicSearchGet(
      req("/api/public/search?q=agent&mode=lexical&limit=2"),
    );
    expect(first.status).toBe(200);
    expect(wider.status).toBe(200);

    const firstBody = await first.json();
    const widerBody = await wider.json();
    assertProductionPrecondition(
      widerBody.items.length >= 2,
      "public lexical search must match at least two rows to prove totals",
    );

    expect(firstBody.items.length).toBe(1);
    expect(widerBody.items.length).toBe(2);
    expect(firstBody.total).toBe(widerBody.total);
    expect(firstBody.total).toBeGreaterThan(firstBody.items.length);
    // 20s: two sequential remote lexical scans (LIKE %…% is unindexable);
    // fine at prod's co-located RTT, tight from a dev machine.
  }, 20_000);
});
