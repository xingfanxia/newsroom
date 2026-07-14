import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { closeDb, db, schema } from "@/db/client";
import {
  createCollectionRoutePayload,
  deleteCollectionRoutePayload,
  listCollectionRoutePayload,
  updateCollectionRoutePayload,
} from "@/lib/api/collection-routes";
import { FEEDBACK_SAVE_VOTE } from "@/lib/types";
import { assertProductionIntegrationOptIn } from "@/scripts/verification/run-hermetic-tests";
import { assertProductionPrecondition } from "@/tests/integration/production/preconditions";

assertProductionIntegrationOptIn();

describe("collection route payload helpers (real DB)", () => {
  const ownerUserId = `collection-route-owner-${crypto.randomUUID()}`;
  const otherUserId = `collection-route-other-${crypto.randomUUID()}`;
  const ownerEmail = `${ownerUserId}@example.test`;
  const otherEmail = `${otherUserId}@example.test`;
  const collectionName = `route collection ${crypto.randomUUID()}`;
  let itemId: number | null = null;

  beforeAll(async () => {
    const [item] = await db()
      .select({ id: schema.items.id })
      .from(schema.items)
      .limit(1);
    itemId = item?.id ?? null;

    await db()
      .insert(schema.users)
      .values([
        { id: ownerUserId, email: ownerEmail, role: "reader" },
        { id: otherUserId, email: otherEmail, role: "reader" },
      ])
      .onConflictDoNothing();
  });

  afterAll(async () => {
    await db().delete(schema.users).where(eq(schema.users.id, ownerUserId));
    await db().delete(schema.users).where(eq(schema.users.id, otherUserId));
    await closeDb();
  });

  test("runs owner-scoped CRUD and reparents saves to inbox on delete", async () => {
    assertProductionPrecondition(
      itemId !== null,
      "items table must contain a row for collection route coverage",
    );

    const created = await createCollectionRoutePayload({
      userId: ownerUserId,
      name: `  ${collectionName}  `,
      nameCjk: "  阅读  ",
      pinned: false,
    });
    expect(created.ok).toBe(true);
    assertProductionPrecondition(
      created.ok,
      "collection creation must succeed before CRUD assertions",
    );

    const collection = created.payload.collection;
    expect(collection).toMatchObject({
      name: collectionName,
      nameCjk: "阅读",
      pinned: false,
      count: 0,
    });

    await expect(
      createCollectionRoutePayload({
        userId: ownerUserId,
        name: collectionName,
      }),
    ).resolves.toEqual({
      ok: false,
      error: "duplicate_name",
      status: 409,
    });

    await db()
      .insert(schema.feedback)
      .values({
        userId: ownerUserId,
        itemId,
        vote: FEEDBACK_SAVE_VOTE,
        collectionId: collection.id,
      })
      .onConflictDoNothing();

    const listed = await listCollectionRoutePayload(ownerUserId);
    expect(listed.total).toBe(1);
    expect(listed.collections[0]).toMatchObject({
      id: collection.id,
      name: collectionName,
      count: 1,
    });

    await expect(
      updateCollectionRoutePayload({
        userId: otherUserId,
        id: collection.id,
        name: "not yours",
      }),
    ).resolves.toEqual({ ok: false, error: "not_found", status: 404 });

    await expect(
      updateCollectionRoutePayload({
        userId: ownerUserId,
        id: collection.id,
        name: `${collectionName} updated`,
        nameCjk: null,
        pinned: true,
      }),
    ).resolves.toEqual({ ok: true, payload: {} });

    const updated = await listCollectionRoutePayload(ownerUserId);
    expect(updated.collections[0]).toMatchObject({
      id: collection.id,
      name: `${collectionName} updated`,
      nameCjk: null,
      pinned: true,
      count: 1,
    });

    await expect(
      deleteCollectionRoutePayload(otherUserId, collection.id),
    ).resolves.toEqual({ ok: false, error: "not_found", status: 404 });

    await expect(
      deleteCollectionRoutePayload(ownerUserId, collection.id),
    ).resolves.toEqual({ ok: true, payload: {} });

    const [save] = await db()
      .select({ collectionId: schema.feedback.collectionId })
      .from(schema.feedback)
      .where(
        and(
          eq(schema.feedback.userId, ownerUserId),
          eq(schema.feedback.itemId, itemId),
          eq(schema.feedback.vote, FEEDBACK_SAVE_VOTE),
        ),
      )
      .limit(1);
    expect(save?.collectionId).toBeNull();

    const afterDelete = await listCollectionRoutePayload(ownerUserId);
    expect(afterDelete).toEqual({ collections: [], total: 0 });
  });
});
