import { describe, expect, it } from "bun:test";
import {
  computeEtag,
  etagSignal,
  ifNoneMatch,
  notModified,
  publicError,
  publicHeaders,
  publicJson,
} from "@/lib/api/public-helpers";

describe("public-helpers — etag + CORS + cache", () => {
  describe("computeEtag", () => {
    it("returns weak ETag with the family prefix and 16-char hash", () => {
      const tag = computeEtag("public-feed", "anything");
      expect(tag).toMatch(/^W\/"public-feed-[0-9a-f]{16}"$/);
    });

    it("is deterministic for the same signal", () => {
      const a = computeEtag("public-feed", "n=10|first=abc");
      const b = computeEtag("public-feed", "n=10|first=abc");
      expect(a).toBe(b);
    });

    it("differs when family differs", () => {
      const a = computeEtag("public-feed", "n=10");
      const b = computeEtag("public-items", "n=10");
      expect(a).not.toBe(b);
    });

    it("differs when signal differs", () => {
      const a = computeEtag("public-feed", "n=10|first=abc");
      const b = computeEtag("public-feed", "n=11|first=abc");
      expect(a).not.toBe(b);
    });
  });

  describe("etagSignal", () => {
    it("joins key/value pairs deterministically", () => {
      const s = etagSignal({ count: 5, first: "abc", at: null });
      expect(s).toBe("count=5|first=abc|at=");
    });
  });

  describe("ifNoneMatch", () => {
    it("returns true when header matches the etag", () => {
      const etag = `W/"public-feed-deadbeefdeadbeef"`;
      const req = new Request("https://x.test/", {
        headers: { "if-none-match": etag },
      });
      expect(ifNoneMatch(req, etag)).toBe(true);
    });

    it("returns false when header is missing", () => {
      const req = new Request("https://x.test/");
      expect(ifNoneMatch(req, `W/"x-abc"`)).toBe(false);
    });

    it("returns false when header value differs", () => {
      const req = new Request("https://x.test/", {
        headers: { "if-none-match": `W/"x-abc"` },
      });
      expect(ifNoneMatch(req, `W/"x-def"`)).toBe(false);
    });
  });

  describe("publicHeaders", () => {
    it("pins cors + cache-control + etag + vary defaults", () => {
      const h = publicHeaders(`W/"x-abc"`);
      expect(h.etag).toBe(`W/"x-abc"`);
      expect(h["cache-control"]).toBe(
        "public, s-maxage=60, stale-while-revalidate=300",
      );
      expect(h["access-control-allow-origin"]).toBe("*");
      expect(h["access-control-allow-methods"]).toBe("GET, OPTIONS");
      expect(h.vary).toBe("accept-language, accept");
    });

    it("respects custom sMaxAge + staleWhileRevalidate", () => {
      const h = publicHeaders(`W/"x"`, {
        sMaxAge: 3600,
        staleWhileRevalidate: 86_400,
      });
      expect(h["cache-control"]).toBe(
        "public, s-maxage=3600, stale-while-revalidate=86400",
      );
    });
  });

  describe("notModified", () => {
    it("returns 304 with empty body and the etag", () => {
      const res = notModified(`W/"x-abc"`);
      expect(res.status).toBe(304);
      expect(res.headers.get("etag")).toBe(`W/"x-abc"`);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
    });
  });

  describe("publicJson", () => {
    it("returns 200 JSON with etag + CORS", async () => {
      const res = publicJson({ ok: true }, `W/"x-1"`);
      expect(res.status).toBe(200);
      expect(res.headers.get("etag")).toBe(`W/"x-1"`);
      expect(res.headers.get("content-type")).toContain("application/json");
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      const body = await res.json();
      expect(body).toEqual({ ok: true });
    });
  });

  describe("publicError", () => {
    it("returns the given status, JSON error envelope, + CORS", async () => {
      const res = publicError("invalid_query", 400);
      expect(res.status).toBe(400);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      const body = await res.json();
      expect(body).toEqual({ error: "invalid_query" });
    });
  });
});
