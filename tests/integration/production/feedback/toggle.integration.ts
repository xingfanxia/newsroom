import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { and, eq } from "drizzle-orm";
import { closeDb, db, schema } from "@/db/client";
import {
  applyFeedbackToggle,
  currentVotes,
} from "@/lib/feedback/toggle";
import { assertProductionIntegrationOptIn } from "@/scripts/verification/run-hermetic-tests";
import { requireProductionFixture } from "@/tests/integration/production/preconditions";

assertProductionIntegrationOptIn();

// Each toggle does several sequential round-trips (upsert user → upsert
// feedback → clear opposite vote, in an interactive txn). Against a remote
// Turso primary the default 5s bun timeout is too tight — a transient latency
// spike or a concurrent cron write (global SQLite write lock) intermittently
// tripped it. Generous per-test ceiling; the assertions are unchanged.
const REAL_DB_TIMEOUT_MS = 20_000;

describe("applyFeedbackToggle (real DB)", () => {
  const TEST_USER_ID = `m3-toggle-${crypto.randomUUID()}`;
  const TEST_EMAIL = `m3-toggle-${Date.now()}@example.test`;
  let itemId: number | null = null;

  async function cleanFeedback() {
    await db()
      .delete(schema.feedback)
      .where(eq(schema.feedback.userId, TEST_USER_ID));
  }

  beforeAll(async () => {
    const rows = await db()
      .select({ id: schema.items.id })
      .from(schema.items)
      .limit(1);
    itemId = rows[0]?.id ?? null;
  });

  afterAll(async () => {
    await cleanFeedback();
    await db().delete(schema.users).where(eq(schema.users.id, TEST_USER_ID));
    await closeDb();
  });

  it("setting up=on while down exists clears down (mutual exclusion)", async () => {
    const fixtureItemId = requireProductionFixture(
      itemId,
      "toggle test requires an existing item",
    );
    await cleanFeedback();
    const user = { id: TEST_USER_ID, email: TEST_EMAIL, isAdmin: false };

    // Pre-seed a 'down' vote directly.
    await applyFeedbackToggle(user, {
      itemId: fixtureItemId,
      vote: "down",
      on: true,
    });
    expect((await currentVotes(TEST_USER_ID, fixtureItemId)).down).toBe(true);

    // Now toggle 'up' on — 'down' should clear.
    const after = await applyFeedbackToggle(user, {
      itemId: fixtureItemId,
      vote: "up",
      on: true,
    });
    expect(after).toEqual({ up: true, down: false, save: false });
  }, REAL_DB_TIMEOUT_MS);

  it("save is independent of up/down and persists through them", async () => {
    const fixtureItemId = requireProductionFixture(
      itemId,
      "toggle test requires an existing item",
    );
    await cleanFeedback();
    const user = { id: TEST_USER_ID, email: TEST_EMAIL, isAdmin: false };

    await applyFeedbackToggle(user, {
      itemId: fixtureItemId,
      vote: "save",
      on: true,
    });
    await applyFeedbackToggle(user, {
      itemId: fixtureItemId,
      vote: "up",
      on: true,
    });
    const state = await currentVotes(TEST_USER_ID, fixtureItemId);
    expect(state).toEqual({ up: true, down: false, save: true });
  }, REAL_DB_TIMEOUT_MS);

  it("setting on=false clears the vote", async () => {
    const fixtureItemId = requireProductionFixture(
      itemId,
      "toggle test requires an existing item",
    );
    await cleanFeedback();
    const user = { id: TEST_USER_ID, email: TEST_EMAIL, isAdmin: false };

    await applyFeedbackToggle(user, {
      itemId: fixtureItemId,
      vote: "up",
      on: true,
    });
    const after = await applyFeedbackToggle(user, {
      itemId: fixtureItemId,
      vote: "up",
      on: false,
    });
    expect(after.up).toBe(false);
  }, REAL_DB_TIMEOUT_MS);

  it("is idempotent — setting the same vote twice still yields one row", async () => {
    const fixtureItemId = requireProductionFixture(
      itemId,
      "toggle test requires an existing item",
    );
    await cleanFeedback();
    const user = { id: TEST_USER_ID, email: TEST_EMAIL, isAdmin: false };

    await applyFeedbackToggle(user, {
      itemId: fixtureItemId,
      vote: "up",
      on: true,
    });
    await applyFeedbackToggle(user, {
      itemId: fixtureItemId,
      vote: "up",
      on: true,
    });

    const rows = await db()
      .select({ id: schema.feedback.id })
      .from(schema.feedback)
      .where(
        and(
          eq(schema.feedback.userId, TEST_USER_ID),
          eq(schema.feedback.itemId, fixtureItemId),
          eq(schema.feedback.vote, "up"),
        ),
      );
    expect(rows).toHaveLength(1);
  }, REAL_DB_TIMEOUT_MS);

  it("upserts an app user row on first toggle so the FK resolves", async () => {
    const fixtureItemId = requireProductionFixture(
      itemId,
      "toggle test requires an existing item",
    );
    // Ensure no user row exists before this test.
    await db().delete(schema.users).where(eq(schema.users.id, TEST_USER_ID));
    const user = { id: TEST_USER_ID, email: TEST_EMAIL, isAdmin: false };

    await applyFeedbackToggle(user, {
      itemId: fixtureItemId,
      vote: "save",
      on: true,
    });

    const rows = await db()
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, TEST_USER_ID));
    expect(rows[0]?.email).toBe(TEST_EMAIL);
  }, REAL_DB_TIMEOUT_MS);
});
