import { describe, expect, test } from "bun:test";
import { GET as publicFeedGet } from "@/app/api/public/feed/route";

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
    if (widerBody.items.length < 2) {
      // Fresh or tiny dev DB: not enough rows to prove pagination totals.
      return;
    }

    expect(firstBody.items.length).toBe(1);
    expect(widerBody.items.length).toBe(2);
    expect(firstBody.total).toBe(widerBody.total);
    expect(firstBody.total).toBeGreaterThan(firstBody.items.length);
  });
});
