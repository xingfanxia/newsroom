import { describe, expect, test } from "bun:test";
import {
  plainError,
  plainJson,
  plainServerError,
} from "@/lib/api/plain-response";

describe("plain response helpers", () => {
  test("plainJson returns a plain JSON response without an ok envelope", async () => {
    const res = plainJson({ value: 1 });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ value: 1 });
  });

  test("plainError returns the shared plain error envelope", async () => {
    const res = plainError("not_found", 404);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  test("plainServerError logs the route label and returns the shared 500 envelope", async () => {
    const originalError = console.error;
    const calls: unknown[][] = [];
    console.error = (...args: unknown[]) => {
      calls.push(args);
    };

    try {
      const err = new Error("boom");
      const res = plainServerError("api/example", err);

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "server_error" });
      expect(calls).toEqual([["[api/example] failed", err]]);
    } finally {
      console.error = originalError;
    }
  });
});
