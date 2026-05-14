import { beforeEach, describe, expect, it } from "bun:test";
import {
  publicRateLimit,
  __resetPublicBuckets,
  type RateLimitConfig,
} from "@/lib/rate-limit/public";

const TEST_CFG: RateLimitConfig = {
  family: "test",
  windowMs: 60_000,
  max: 3,
};

function reqFromIp(ip: string): Request {
  return new Request("https://x.test/", {
    headers: { "x-forwarded-for": ip },
  });
}

describe("public rate limit", () => {
  beforeEach(() => {
    __resetPublicBuckets();
  });

  it("lets requests through under the cap", () => {
    const req = reqFromIp("1.2.3.4");
    expect(publicRateLimit(req, TEST_CFG)).toBeNull();
    expect(publicRateLimit(req, TEST_CFG)).toBeNull();
    expect(publicRateLimit(req, TEST_CFG)).toBeNull();
  });

  it("returns 429 once over the cap", () => {
    const req = reqFromIp("1.2.3.4");
    publicRateLimit(req, TEST_CFG);
    publicRateLimit(req, TEST_CFG);
    publicRateLimit(req, TEST_CFG);
    const fourth = publicRateLimit(req, TEST_CFG);
    expect(fourth).not.toBeNull();
    expect(fourth!.status).toBe(429);
    expect(fourth!.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(fourth!.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("isolates buckets by IP", () => {
    const a = reqFromIp("1.1.1.1");
    const b = reqFromIp("2.2.2.2");
    publicRateLimit(a, TEST_CFG);
    publicRateLimit(a, TEST_CFG);
    publicRateLimit(a, TEST_CFG);
    expect(publicRateLimit(a, TEST_CFG)).not.toBeNull();
    expect(publicRateLimit(b, TEST_CFG)).toBeNull();
  });

  it("isolates buckets by family — /feed doesn't burn /search budget", () => {
    const req = reqFromIp("1.2.3.4");
    const feedCfg: RateLimitConfig = { family: "feed", windowMs: 60_000, max: 2 };
    const searchCfg: RateLimitConfig = { family: "search", windowMs: 60_000, max: 2 };

    publicRateLimit(req, feedCfg);
    publicRateLimit(req, feedCfg);
    expect(publicRateLimit(req, feedCfg)).not.toBeNull();
    expect(publicRateLimit(req, searchCfg)).toBeNull();
  });

  it("respects x-real-ip when x-forwarded-for is absent", () => {
    const req = new Request("https://x.test/", {
      headers: { "x-real-ip": "5.6.7.8" },
    });
    expect(publicRateLimit(req, TEST_CFG)).toBeNull();
  });

  it("uses 'unknown' bucket when no IP headers — same client treated together", () => {
    const a = new Request("https://x.test/");
    const b = new Request("https://x.test/");
    publicRateLimit(a, TEST_CFG);
    publicRateLimit(a, TEST_CFG);
    publicRateLimit(b, TEST_CFG);
    expect(publicRateLimit(b, TEST_CFG)).not.toBeNull();
  });
});
