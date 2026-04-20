/**
 * /api/v1/* integration test — real DB, real route handlers, no mocks.
 *
 * Strategy: mint a scoped test-only API token in beforeAll, hit each
 * route by importing its GET handler and calling it with a synthetic
 * Request (the same shape Next.js passes at runtime), then clean up
 * in afterAll. No HTTP server needed because Next.js route handlers
 * are just async functions.
 *
 * The test is additive — we never mutate items, sources, or feedback.
 * Only the api_tokens row we minted is touched, and we delete it on
 * teardown.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { apiTokens } from "@/db/schema";
import { ADMIN_USER_ID, upsertAppUser } from "@/lib/auth/session";
import { GET as feedGet } from "@/app/api/v1/feed/route";
import { GET as sourcesGet } from "@/app/api/v1/sources/route";
import { GET as searchGet } from "@/app/api/v1/search/route";
import { GET as itemGet } from "@/app/api/v1/items/[id]/route";

let token: string;
let tokenId: number;

beforeAll(async () => {
  await upsertAppUser({
    id: ADMIN_USER_ID,
    email: "admin@local",
    isAdmin: true,
  });
  token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  const [row] = await db()
    .insert(apiTokens)
    .values({
      userId: ADMIN_USER_ID,
      tokenHash: hash,
      label: "int-test-v1",
    })
    .returning({ id: apiTokens.id });
  tokenId = row.id;
});

afterAll(async () => {
  if (tokenId) {
    await db().delete(apiTokens).where(eq(apiTokens.id, tokenId));
  }
});

function authedReq(path: string): Request {
  return new Request(`http://localhost${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

describe("/api/v1 auth gate", () => {
  test("rejects missing bearer with 401", async () => {
    const res = await feedGet(new Request("http://localhost/api/v1/feed"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("missing_bearer");
  });

  test("rejects invalid bearer with 401", async () => {
    const res = await feedGet(
      new Request("http://localhost/api/v1/feed", {
        headers: { Authorization: "Bearer not-a-real-token" },
      }),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("invalid_token");
  });

  test("rejects revoked bearer with 401", async () => {
    const scratchToken = randomBytes(32).toString("base64url");
    const hash = createHash("sha256").update(scratchToken).digest("hex");
    const [row] = await db()
      .insert(apiTokens)
      .values({
        userId: ADMIN_USER_ID,
        tokenHash: hash,
        label: "int-test-revoked",
        revokedAt: new Date(),
      })
      .returning({ id: apiTokens.id });
    try {
      const res = await feedGet(
        new Request("http://localhost/api/v1/feed", {
          headers: { Authorization: `Bearer ${scratchToken}` },
        }),
      );
      expect(res.status).toBe(401);
    } finally {
      await db().delete(apiTokens).where(eq(apiTokens.id, row.id));
    }
  });
});

describe("/api/v1/feed", () => {
  test("returns paginated items array with total", async () => {
    const res = await feedGet(authedReq("/api/v1/feed?limit=5"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeLessThanOrEqual(5);
    expect(typeof body.total).toBe("number");
    expect(body.limit).toBe(5);
    expect(body.offset).toBe(0);
    if (body.items.length > 0) {
      const item = body.items[0];
      expect(typeof item.id).toBe("string");
      expect(typeof item.title).toBe("string");
      expect(typeof item.source_id).toBe("string");
      expect(typeof item.published_at).toBe("string");
      expect(item.published_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(["featured", "p1", "all", "excluded"]).toContain(item.tier);
    }
  });

  test("rejects invalid tier with 400", async () => {
    const res = await feedGet(authedReq("/api/v1/feed?tier=bogus"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_query");
  });

  test("rejects limit over 500", async () => {
    const res = await feedGet(authedReq("/api/v1/feed?limit=9999"));
    expect(res.status).toBe(400);
  });

  test("source_id filter narrows results", async () => {
    const res = await feedGet(
      authedReq("/api/v1/feed?tier=all&source_id=dwarkesh-yt&limit=10"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    for (const item of body.items) {
      expect(item.source_id).toBe("dwarkesh-yt");
    }
  });
});

describe("/api/v1/items/:id", () => {
  test("returns 400 for non-numeric id", async () => {
    const res = await itemGet(authedReq("/api/v1/items/abc"), {
      params: Promise.resolve({ id: "abc" }),
    });
    expect(res.status).toBe(400);
  });

  test("returns 404 for unknown id", async () => {
    const res = await itemGet(authedReq("/api/v1/items/999999999"), {
      params: Promise.resolve({ id: "999999999" }),
    });
    expect(res.status).toBe(404);
  });

  test("returns full detail for a real item", async () => {
    const feed = await feedGet(authedReq("/api/v1/feed?limit=1&tier=all"));
    const feedBody = await feed.json();
    if (feedBody.items.length === 0) {
      // No items in DB — skip rather than fail (fresh dev DB scenario).
      return;
    }
    const id = feedBody.items[0].id;
    const res = await itemGet(authedReq(`/api/v1/items/${id}`), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(id);
    expect(typeof body.source.id).toBe("string");
    expect(typeof body.title.raw).toBe("string");
    expect(body.summary).toBeDefined();
    expect(body.editor_note).toBeDefined();
    expect(body.published_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("/api/v1/sources", () => {
  test("returns sources with health", async () => {
    const res = await sourcesGet(authedReq("/api/v1/sources"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.sources)).toBe(true);
    expect(body.total).toBe(body.sources.length);
    if (body.sources.length > 0) {
      const s = body.sources[0];
      expect(typeof s.id).toBe("string");
      expect(typeof s.name_en).toBe("string");
      expect(typeof s.kind).toBe("string");
      expect(typeof s.enabled).toBe("boolean");
      expect(s.health).toBeDefined();
      expect(["ok", "warning", "error", "pending"]).toContain(s.health.status);
    }
  });
});

describe("/api/v1/search", () => {
  test("returns 400 when q is missing", async () => {
    const res = await searchGet(authedReq("/api/v1/search"));
    expect(res.status).toBe(400);
  });

  test("semantic mode returns ranked items with distance", async () => {
    const res = await searchGet(
      authedReq("/api/v1/search?q=autonomous+coding+agent&mode=semantic&limit=5"),
    );
    // Can be 200 on success or 500 if AZURE_OPENAI_EMBEDDING_DEPLOYMENT is
    // missing / rate-limited in the test env. Accept either and only
    // assert the shape when we got data back.
    if (res.status === 200) {
      const body = await res.json();
      expect(body.mode).toBe("semantic");
      expect(body.q).toBe("autonomous coding agent");
      expect(Array.isArray(body.items)).toBe(true);
      expect(typeof body.embedding_dims).toBe("number");
      expect(typeof body.latency_ms).toBe("number");
      if (body.items.length > 0) {
        expect(typeof body.items[0].distance).toBe("number");
      }
    } else {
      expect(res.status).toBe(500);
    }
  });

  test("lexical search returns shape matching /feed items", async () => {
    const res = await searchGet(
      authedReq("/api/v1/search?q=agent&mode=lexical&limit=5"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("lexical");
    expect(body.q).toBe("agent");
    expect(Array.isArray(body.items)).toBe(true);
    expect(typeof body.total).toBe("number");
  });
});
