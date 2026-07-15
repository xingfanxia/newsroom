import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { GET as searchGet } from "@/app/api/v1/search/route";
import { db } from "@/db/client";
import { apiTokens } from "@/db/schema";
import { ADMIN_USER_ID, upsertAppUser } from "@/lib/auth/session";
import { assertProductionIntegrationOptIn } from "@/scripts/verification/run-hermetic-tests";

assertProductionIntegrationOptIn();
if (process.env.RUN_LIVE_SEMANTIC_TEST !== "1") {
  throw new Error("Live semantic integration requires RUN_LIVE_SEMANTIC_TEST=1");
}

let token = "";
let tokenId = 0;

beforeAll(async () => {
  await upsertAppUser({
    id: ADMIN_USER_ID,
    email: "admin@local",
    isAdmin: true,
  });
  token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const [row] = await db()
    .insert(apiTokens)
    .values({
      userId: ADMIN_USER_ID,
      tokenHash,
      label: "int-test-v1-semantic",
    })
    .returning({ id: apiTokens.id });
  tokenId = row.id;
});

afterAll(async () => {
  if (tokenId !== 0) {
    await db().delete(apiTokens).where(eq(apiTokens.id, tokenId));
  }
});

test("semantic mode returns ranked items with distance", async () => {
  const response = await searchGet(
    new Request(
      "http://localhost/api/v1/search?q=autonomous+coding+agent&mode=semantic&limit=5",
      { headers: { Authorization: `Bearer ${token}` } },
    ),
  );
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.mode).toBe("semantic");
  expect(body.q).toBe("autonomous coding agent");
  expect(Array.isArray(body.items)).toBe(true);
  expect(typeof body.embedding_dims).toBe("number");
  expect(typeof body.latency_ms).toBe("number");
  if (body.items.length > 0) {
    expect(typeof body.items[0].distance).toBe("number");
  }
});
