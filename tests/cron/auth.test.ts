import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { verifyCron } from "@/app/api/cron/_auth";

const ORIGINAL_SECRET = process.env.CRON_SECRET;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

function reqWithAuth(auth: string | null): Request {
  const headers = new Headers();
  if (auth !== null) headers.set("authorization", auth);
  return new Request("https://example.test/api/cron/test", { headers });
}

describe("verifyCron", () => {
  afterEach(() => {
    if (ORIGINAL_SECRET !== undefined) {
      process.env.CRON_SECRET = ORIGINAL_SECRET;
    } else {
      delete process.env.CRON_SECRET;
    }
    if (ORIGINAL_NODE_ENV !== undefined) {
      // @ts-expect-error overriding for test
      process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    }
  });

  it("returns 401 on wrong secret", async () => {
    process.env.CRON_SECRET = "right-secret";
    const res = verifyCron(reqWithAuth("Bearer wrong-secret"));
    expect(res?.status).toBe(401);
  });

  it("returns 401 on missing header", async () => {
    process.env.CRON_SECRET = "right-secret";
    const res = verifyCron(reqWithAuth(null));
    expect(res?.status).toBe(401);
  });

  it("returns 401 on empty header value", async () => {
    process.env.CRON_SECRET = "right-secret";
    const res = verifyCron(reqWithAuth(""));
    expect(res?.status).toBe(401);
  });

  it("returns 401 when auth format is wrong", async () => {
    process.env.CRON_SECRET = "right-secret";
    const res = verifyCron(reqWithAuth("right-secret"));
    expect(res?.status).toBe(401);
  });

  it("returns null (allow) on correct secret", async () => {
    process.env.CRON_SECRET = "right-secret";
    expect(verifyCron(reqWithAuth("Bearer right-secret"))).toBeNull();
  });

  it("returns 500 in production when CRON_SECRET is unset", async () => {
    delete process.env.CRON_SECRET;
    // @ts-expect-error overriding for test
    process.env.NODE_ENV = "production";
    const res = verifyCron(reqWithAuth("Bearer whatever"));
    expect(res?.status).toBe(500);
  });

  it("allows through in development when CRON_SECRET is unset", async () => {
    delete process.env.CRON_SECRET;
    // @ts-expect-error overriding for test
    process.env.NODE_ENV = "development";
    expect(verifyCron(reqWithAuth("Bearer whatever"))).toBeNull();
  });
});
