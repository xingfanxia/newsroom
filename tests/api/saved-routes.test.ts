import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { and, eq, sql } from "drizzle-orm";
import { closeDb, db, schema } from "@/db/client";
import {
  listSavedItemsRoutePayload,
  moveSavedItemRoutePayload,
  saveItemRoutePayload,
} from "@/lib/api/saved-routes";
import type { SessionUser } from "@/lib/auth/session";

const hasDb = Boolean(process.env.TURSO_DATABASE_URL);
const describeOrSkip = hasDb ? describe : describe.skip;

describeOrSkip("saveItemRoutePayload (real DB)", () => {
  const ownerUserId = `saved-route-owner-${crypto.randomUUID()}`;
  const otherUserId = `saved-route-other-${crypto.randomUUID()}`;
  const ownerUser: SessionUser = {
    id: ownerUserId,
    email: `${ownerUserId}@example.test`,
    isAdmin: false,
  };
  let itemId: number | null = null;
  let missingItemId: number | null = null;
  let ownerCollectionId: number | null = null;
  let otherCollectionId: number | null = null;

  async function cleanOwnerSave() {
    await db()
      .delete(schema.feedback)
      .where(
        and(
          eq(schema.feedback.userId, ownerUserId),
          eq(schema.feedback.vote, "save"),
        ),
      );
  }

  async function currentOwnerSave() {
    if (itemId === null) return null;
    const [row] = await db()
      .select({
        collectionId: schema.feedback.collectionId,
        note: schema.feedback.note,
      })
      .from(schema.feedback)
      .where(
        and(
          eq(schema.feedback.userId, ownerUserId),
          eq(schema.feedback.itemId, itemId),
          eq(schema.feedback.vote, "save"),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  beforeAll(async () => {
    const [item] = await db()
      .select({ id: schema.items.id })
      .from(schema.items)
      .limit(1);
    itemId = item?.id ?? null;
    if (itemId === null) return;

    const [maxItem] = await db()
      .select({
        maxId: sql<number>`coalesce(max(${schema.items.id}), 0)`,
      })
      .from(schema.items);
    missingItemId = (maxItem?.maxId ?? 0) + 1_000_000;

    await db()
      .insert(schema.users)
      .values([
        {
          id: ownerUserId,
          email: ownerUser.email,
          role: "reader",
        },
        {
          id: otherUserId,
          email: `${otherUserId}@example.test`,
          role: "reader",
        },
      ])
      .onConflictDoNothing();

    const [ownerCollection] = await db()
      .insert(schema.savedCollections)
      .values({
        userId: ownerUserId,
        name: `owner-${crypto.randomUUID()}`,
      })
      .returning({ id: schema.savedCollections.id });
    const [otherCollection] = await db()
      .insert(schema.savedCollections)
      .values({
        userId: otherUserId,
        name: `other-${crypto.randomUUID()}`,
      })
      .returning({ id: schema.savedCollections.id });
    ownerCollectionId = ownerCollection.id;
    otherCollectionId = otherCollection.id;
  });

  beforeEach(async () => {
    if (itemId !== null) await cleanOwnerSave();
  });

  afterAll(async () => {
    await db().delete(schema.users).where(eq(schema.users.id, ownerUserId));
    await db().delete(schema.users).where(eq(schema.users.id, otherUserId));
    await closeDb();
  });

  it("saves into an owned collection, reports the assignment, and unsaves", async () => {
    if (
      itemId === null ||
      ownerCollectionId === null ||
      otherCollectionId === null
    ) {
      return;
    }

    const saved = await saveItemRoutePayload(ownerUser, {
      itemId,
      on: true,
      collectionId: ownerCollectionId,
      note: "route helper note",
    });

    expect(saved).toEqual({
      ok: true,
      payload: {
        item_id: itemId,
        saved: true,
        collection_id: ownerCollectionId,
      },
    });
    expect(await currentOwnerSave()).toEqual({
      collectionId: ownerCollectionId,
      note: "route helper note",
    });

    const list = await listSavedItemsRoutePayload(ownerUser, {
      locale: "en",
      limit: 80,
    });
    expect(list.total).toBeGreaterThanOrEqual(1);
    expect(
      list.items.some(
        (item) =>
          item.id === String(itemId) &&
          item.collection_id === ownerCollectionId,
      ),
    ).toBe(true);

    const foreignMove = await moveSavedItemRoutePayload(ownerUser, {
      itemId,
      targetCollectionId: otherCollectionId,
    });
    expect(foreignMove).toEqual({
      ok: false,
      error: "not_found",
      status: 404,
    });
    expect(await currentOwnerSave()).toEqual({
      collectionId: ownerCollectionId,
      note: "route helper note",
    });

    await expect(
      moveSavedItemRoutePayload(ownerUser, {
        itemId,
        targetCollectionId: null,
      }),
    ).resolves.toEqual({ ok: true });
    expect(await currentOwnerSave()).toEqual({
      collectionId: null,
      note: "route helper note",
    });

    await expect(
      moveSavedItemRoutePayload(ownerUser, {
        itemId,
        targetCollectionId: ownerCollectionId,
      }),
    ).resolves.toEqual({ ok: true });
    expect(await currentOwnerSave()).toEqual({
      collectionId: ownerCollectionId,
      note: "route helper note",
    });

    const repeated = await saveItemRoutePayload(ownerUser, {
      itemId,
      on: true,
    });
    expect(repeated).toEqual(saved);

    const unsaved = await saveItemRoutePayload(ownerUser, {
      itemId,
      on: false,
    });
    expect(unsaved).toEqual({
      ok: true,
      payload: { item_id: itemId, saved: false, collection_id: null },
    });
    expect(await currentOwnerSave()).toBeNull();
  });

  it("rejects another user's collection id before creating a save", async () => {
    if (itemId === null || otherCollectionId === null) return;

    const result = await saveItemRoutePayload(ownerUser, {
      itemId,
      on: true,
      collectionId: otherCollectionId,
    });

    expect(result).toEqual({
      ok: false,
      error: "collection_not_found",
      status: 404,
    });
    expect(await currentOwnerSave()).toBeNull();
  });

  it("maps a missing item foreign-key failure to item_not_found", async () => {
    if (missingItemId === null) return;

    const result = await saveItemRoutePayload(ownerUser, {
      itemId: missingItemId,
      on: true,
    });

    expect(result).toEqual({
      ok: false,
      error: "item_not_found",
      status: 404,
    });
  });
});
