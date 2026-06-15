import {
  toSavedAgentApiItem,
  type SavedAgentApiItem,
} from "@/lib/api/v1-items";
import { applyFeedbackToggle } from "@/lib/feedback/toggle";
import {
  assignSavedItemCollection,
  getSavedItemCollectionId,
  userOwnsSavedCollection,
} from "@/lib/items/collections";
import { getSavedStories } from "@/lib/items/saved";
import { FEEDBACK_SAVE_VOTE, type AppLocale } from "@/lib/types";
import type { SessionUser } from "@/lib/auth/session";

type ListSavedItemsRouteQuery = {
  locale: AppLocale;
  limit: number;
  collection?: number | "inbox";
};

type ListSavedItemsRoutePayload = {
  items: SavedAgentApiItem[];
  total: number;
};

type SaveItemRouteBody = {
  itemId: number;
  on: boolean;
  collectionId?: number;
  note?: string;
};

type SaveItemRoutePayload = {
  item_id: number;
  saved: boolean;
  collection_id: number | null;
};

type SaveItemRouteResult =
  | { ok: true; payload: SaveItemRoutePayload }
  | {
      ok: false;
      error: "collection_not_found" | "save_not_found" | "item_not_found";
      status: 404;
    };

export async function listSavedItemsRoutePayload(
  user: Pick<SessionUser, "id">,
  query: ListSavedItemsRouteQuery,
): Promise<ListSavedItemsRoutePayload> {
  const stories = await getSavedStories(user.id, query.locale, {
    limit: query.limit,
    collection: query.collection ?? null,
  });

  return {
    items: stories.map((story) => toSavedAgentApiItem(story, query.locale)),
    total: stories.length,
  };
}

export async function saveItemRoutePayload(
  user: SessionUser,
  body: SaveItemRouteBody,
): Promise<SaveItemRouteResult> {
  if (
    body.on &&
    body.collectionId !== undefined &&
    !(await userOwnsSavedCollection(user.id, body.collectionId))
  ) {
    return { ok: false, error: "collection_not_found", status: 404 };
  }

  let votes: Awaited<ReturnType<typeof applyFeedbackToggle>>;
  try {
    votes = await applyFeedbackToggle(user, {
      itemId: body.itemId,
      vote: FEEDBACK_SAVE_VOTE,
      on: body.on,
      note: body.note,
    });
  } catch (err) {
    if (isMissingItemForeignKeyError(err)) {
      return { ok: false, error: "item_not_found", status: 404 };
    }
    throw err;
  }

  let collectionId: number | null = null;
  if (votes.save && body.collectionId !== undefined) {
    const assigned = await assignSavedItemCollection({
      userId: user.id,
      itemId: body.itemId,
      targetCollectionId: body.collectionId,
    });
    if (!assigned.ok) {
      return { ok: false, error: assigned.reason, status: 404 };
    }
    collectionId = assigned.collectionId;
  } else if (votes.save) {
    collectionId = await getSavedItemCollectionId(user.id, body.itemId);
  }

  return {
    ok: true,
    payload: {
      item_id: body.itemId,
      saved: votes.save,
      collection_id: collectionId,
    },
  };
}

function isMissingItemForeignKeyError(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 4 && current; depth++) {
    const text = errorSearchText(current);
    if (/foreign key|not present|feedback_item_id_items_id_fk/i.test(text)) {
      return true;
    }

    if (typeof current !== "object") break;
    const cause = (current as { cause?: unknown }).cause;
    if (!cause || cause === current) break;
    current = cause;
  }
  return false;
}

function errorSearchText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err !== "object" || err === null) return String(err);

  const fields = err as {
    message?: unknown;
    detail?: unknown;
    code?: unknown;
    constraint_name?: unknown;
    constraint?: unknown;
  };
  return [
    fields.message,
    fields.detail,
    fields.code,
    fields.constraint_name,
    fields.constraint,
  ]
    .filter((value): value is string => typeof value === "string")
    .join("\n");
}
