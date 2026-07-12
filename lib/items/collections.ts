import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { feedback, savedCollections } from "@/db/schema";
import { FEEDBACK_SAVE_VOTE } from "@/lib/types";

export type SavedCollection = {
  id: number;
  name: string;
  nameCjk: string | null;
  pinned: boolean;
  sortOrder: number;
  count: number;
  createdAt: string;
};

export type SavedItemCollectionAssignment =
  | { ok: true; collectionId: number | null }
  | { ok: false; reason: "collection_not_found" | "save_not_found" };

/**
 * List all named collections for a user + running save counts.
 * Pinned collections surface first. Unrelated to the virtual `inbox` bucket,
 * which is derived at render-time by counting feedback rows with null collection_id.
 */
export async function listCollections(userId: string): Promise<SavedCollection[]> {
  const rows = await db()
    .select({
      id: savedCollections.id,
      name: savedCollections.name,
      nameCjk: savedCollections.nameCjk,
      pinned: savedCollections.pinned,
      sortOrder: savedCollections.sortOrder,
      createdAt: savedCollections.createdAt,
      count: sql<number>`count(${feedback.id})`,
    })
    .from(savedCollections)
    .leftJoin(
      feedback,
      and(
        eq(feedback.userId, savedCollections.userId),
        eq(feedback.collectionId, savedCollections.id),
        eq(feedback.vote, FEEDBACK_SAVE_VOTE),
      ),
    )
    .where(eq(savedCollections.userId, userId))
    .groupBy(
      savedCollections.id,
      savedCollections.name,
      savedCollections.nameCjk,
      savedCollections.pinned,
      savedCollections.sortOrder,
      savedCollections.createdAt,
    )
    .orderBy(
      desc(savedCollections.pinned),
      asc(savedCollections.sortOrder),
      desc(savedCollections.createdAt),
    );

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    nameCjk: r.nameCjk,
    pinned: r.pinned,
    sortOrder: r.sortOrder,
    count: r.count,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Count of uncategorized (inbox) saves for a user. */
export async function getInboxCount(userId: string): Promise<number> {
  const [row] = await db()
    .select({ n: sql<number>`count(*)` })
    .from(feedback)
    .where(
      and(
        eq(feedback.userId, userId),
        eq(feedback.vote, FEEDBACK_SAVE_VOTE),
        sql`${feedback.collectionId} IS NULL`,
      ),
    );
  return row?.n ?? 0;
}

/**
 * Create a new named collection. Throws if name is empty or clashes with an
 * existing collection for this user (unique index is the backstop).
 */
export async function createCollection(input: {
  userId: string;
  name: string;
  nameCjk?: string | null;
  pinned?: boolean;
}): Promise<SavedCollection> {
  const trimmed = input.name.trim();
  if (!trimmed) throw new Error("collection name required");
  if (trimmed.length > 64) throw new Error("collection name too long");

  const [row] = await db()
    .insert(savedCollections)
    .values({
      userId: input.userId,
      name: trimmed,
      nameCjk: input.nameCjk?.trim() || null,
      pinned: input.pinned ?? false,
    })
    .returning();

  return {
    id: row.id,
    name: row.name,
    nameCjk: row.nameCjk,
    pinned: row.pinned,
    sortOrder: row.sortOrder,
    count: 0,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Rename / pin / unpin in one call. Only the owner can mutate. */
export async function updateCollection(input: {
  userId: string;
  id: number;
  name?: string;
  nameCjk?: string | null;
  pinned?: boolean;
}): Promise<boolean> {
  const patch: Partial<typeof savedCollections.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (input.name !== undefined) {
    const trimmed = input.name.trim();
    if (!trimmed) throw new Error("collection name required");
    if (trimmed.length > 64) throw new Error("collection name too long");
    patch.name = trimmed;
  }
  if (input.nameCjk !== undefined) patch.nameCjk = input.nameCjk?.trim() || null;
  if (input.pinned !== undefined) patch.pinned = input.pinned;

  const result = await db()
    .update(savedCollections)
    .set(patch)
    .where(
      and(
        eq(savedCollections.id, input.id),
        eq(savedCollections.userId, input.userId),
      ),
    )
    .returning({ id: savedCollections.id });

  return result.length > 0;
}

/**
 * Delete a collection. Thanks to ON DELETE SET NULL on feedback.collection_id,
 * the user's saved items are reparented to the inbox rather than removed.
 */
export async function deleteCollection(
  userId: string,
  id: number,
): Promise<boolean> {
  const result = await db()
    .delete(savedCollections)
    .where(
      and(
        eq(savedCollections.id, id),
        eq(savedCollections.userId, userId),
      ),
    )
    .returning({ id: savedCollections.id });
  return result.length > 0;
}

/** Return the current collection assignment for one saved item. */
export async function getSavedItemCollectionId(
  userId: string,
  itemId: number,
): Promise<number | null> {
  const [row] = await db()
    .select({ collectionId: feedback.collectionId })
    .from(feedback)
    .where(
      and(
        eq(feedback.userId, userId),
        eq(feedback.itemId, itemId),
        eq(feedback.vote, FEEDBACK_SAVE_VOTE),
      ),
    )
    .limit(1);

  return row?.collectionId ?? null;
}

/** True only when the named saved collection belongs to the user. */
export async function userOwnsSavedCollection(
  userId: string,
  collectionId: number,
): Promise<boolean> {
  const [collection] = await db()
    .select({ id: savedCollections.id })
    .from(savedCollections)
    .where(
      and(
        eq(savedCollections.id, collectionId),
        eq(savedCollections.userId, userId),
      ),
    )
    .limit(1);

  return Boolean(collection);
}

/**
 * Assign a saved item to one of the owner's collections, or null for inbox.
 * A collection id owned by another user is treated the same as a missing id.
 */
export async function assignSavedItemCollection(input: {
  userId: string;
  itemId: number;
  targetCollectionId: number | null;
}): Promise<SavedItemCollectionAssignment> {
  const client = db();

  if (input.targetCollectionId !== null) {
    if (
      !(await userOwnsSavedCollection(input.userId, input.targetCollectionId))
    ) {
      return { ok: false, reason: "collection_not_found" };
    }
  }

  const result = await client
    .update(feedback)
    .set({ collectionId: input.targetCollectionId })
    .where(
      and(
        eq(feedback.userId, input.userId),
        eq(feedback.itemId, input.itemId),
        eq(feedback.vote, FEEDBACK_SAVE_VOTE),
      ),
    )
    .returning({ collectionId: feedback.collectionId });

  if (result.length === 0) {
    return { ok: false, reason: "save_not_found" };
  }

  return { ok: true, collectionId: result[0]?.collectionId ?? null };
}

/**
 * Move a saved item between collections. Passing `targetCollectionId = null`
 * moves it to the inbox. Only the owner's saves and collections are mutable.
 */
export async function moveItemToCollection(input: {
  userId: string;
  itemId: number;
  targetCollectionId: number | null;
}): Promise<boolean> {
  const result = await assignSavedItemCollection(input);
  return result.ok;
}
