/**
 * Unit tests for the SQLITE_BUSY retry wrapper (db/client.ts, W7a).
 *
 * `sleep` is injected as a no-op so the capped exponential backoff runs
 * instantly and deterministically — no real timers, no DB, no contention.
 */
import { describe, expect, it } from "bun:test";
import { isBusyError, withBusyRetry } from "@/db/client";

const noSleep = async () => {};

describe("isBusyError", () => {
  it("matches SQLITE_BUSY and lock messages (case-insensitive)", () => {
    expect(isBusyError(new Error("SQLITE_BUSY: database is locked"))).toBe(true);
    expect(isBusyError(new Error("database is locked"))).toBe(true);
    expect(isBusyError(new Error("database table is locked"))).toBe(true);
    expect(isBusyError(new Error("SQLite_Busy"))).toBe(true);
  });

  it("does NOT match unrelated errors", () => {
    expect(isBusyError(new Error("no such table: items"))).toBe(false);
    expect(isBusyError(new Error("UNIQUE constraint failed"))).toBe(false);
    expect(isBusyError("plain string")).toBe(false);
    expect(isBusyError(null)).toBe(false);
  });
});

describe("withBusyRetry", () => {
  it("returns immediately on success without retrying", async () => {
    let calls = 0;
    const r = await withBusyRetry(
      async () => {
        calls++;
        return "ok";
      },
      { sleep: noSleep },
    );
    expect(r).toBe("ok");
    expect(calls).toBe(1);
  });

  it("retries a transient busy error then succeeds", async () => {
    let calls = 0;
    const r = await withBusyRetry(
      async () => {
        calls++;
        if (calls < 3) throw new Error("SQLITE_BUSY");
        return "ok";
      },
      { sleep: noSleep },
    );
    expect(r).toBe("ok");
    expect(calls).toBe(3); // failed twice, succeeded on the third
  });

  it("gives up after `retries` attempts, rethrowing the busy error", async () => {
    let calls = 0;
    await expect(
      withBusyRetry(
        async () => {
          calls++;
          throw new Error("SQLITE_BUSY");
        },
        { retries: 2, sleep: noSleep },
      ),
    ).rejects.toThrow(/SQLITE_BUSY/);
    expect(calls).toBe(3); // initial attempt + 2 retries
  });

  it("rethrows a non-busy error immediately without retrying", async () => {
    let calls = 0;
    await expect(
      withBusyRetry(
        async () => {
          calls++;
          throw new Error("no such column: foo");
        },
        { sleep: noSleep },
      ),
    ).rejects.toThrow(/no such column/);
    expect(calls).toBe(1); // no retry on non-transient errors
  });

  it("sleeps with capped exponential backoff between attempts", async () => {
    const delays: number[] = [];
    const record = async (ms: number) => {
      delays.push(ms);
    };
    let calls = 0;
    await expect(
      withBusyRetry(
        async () => {
          calls++;
          throw new Error("database is locked");
        },
        { retries: 3, baseDelayMs: 10, sleep: record },
      ),
    ).rejects.toThrow(/database is locked/);
    // one sleep per retry (3), doubling each time from baseDelayMs.
    expect(delays).toEqual([10, 20, 40]);
  });
});
