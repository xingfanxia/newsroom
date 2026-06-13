import { describe, expect, test } from "bun:test";
import {
  runV1Route,
  v1Error,
  v1InvalidQuery,
  v1Json,
} from "@/lib/api/v1-route";

describe("v1 route helpers", () => {
  test("v1Json returns a plain JSON response", async () => {
    const res = v1Json({ ok: true });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ ok: true });
  });

  test("v1Error returns the shared plain error envelope", async () => {
    const res = v1Error("not_found", 404);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  test("v1InvalidQuery keeps validation issues when provided", async () => {
    const issues = [{ path: ["limit"], message: "too big" }];
    const res = v1InvalidQuery(issues);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "invalid_query",
      issues,
    });
  });

  test("runV1Route returns auth denial without running the handler", async () => {
    let ran = false;
    const res = await runV1Route(
      new Request("https://example.test/api/v1/feed"),
      async () => {
        ran = true;
        return v1Json({ ok: true });
      },
    );

    expect(ran).toBe(false);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "missing_bearer" });
  });
});
