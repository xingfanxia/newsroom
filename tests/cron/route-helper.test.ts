import { describe, expect, test } from "bun:test";
import { runCronJsonRoute } from "@/app/api/cron/_route";

function request(auth: string | null): Request {
  return new Request("https://example.test/api/cron/test", {
    headers: auth ? { authorization: auth } : undefined,
  });
}

describe("runCronJsonRoute", () => {
  test("returns auth denial without running the worker", async () => {
    const previousSecret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "test-secret";
    let ran = false;

    try {
      const response = await runCronJsonRoute(request(null), () => {
        ran = true;
        return { kind: "test", payload: "should-not-run" };
      });

      expect(response.status).toBe(401);
      expect(ran).toBe(false);
    } finally {
      process.env.CRON_SECRET = previousSecret;
    }
  });

  test("adds the shared timestamp envelope around worker payloads", async () => {
    const previousSecret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "test-secret";

    try {
      const response = await runCronJsonRoute(
        request("Bearer test-secret"),
        async () => ({ kind: "test", payload: { ok: true } }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.kind).toBe("test");
      expect(body.payload).toEqual({ ok: true });
      expect(Number.isNaN(Date.parse(body.at))).toBe(false);
    } finally {
      process.env.CRON_SECRET = previousSecret;
    }
  });

  test("does not let worker payloads override the shared timestamp", async () => {
    const previousSecret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "test-secret";

    try {
      const response = await runCronJsonRoute(
        request("Bearer test-secret"),
        async () => ({
          kind: "test",
          at: "worker-owned-time",
          payload: { ok: true },
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.kind).toBe("test");
      expect(body.at).not.toBe("worker-owned-time");
      expect(Number.isNaN(Date.parse(body.at))).toBe(false);
    } finally {
      process.env.CRON_SECRET = previousSecret;
    }
  });
});
