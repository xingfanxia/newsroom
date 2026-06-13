import { upsertAppUser } from "@/lib/auth/session";
import {
  adminError,
  adminJson,
  adminOk,
  runAdminRoute,
} from "@/lib/api/admin-route";
import { parseJsonRequestBody } from "@/lib/api/json-body";
import {
  createCollection,
  listCollections,
  updateCollection,
  deleteCollection,
} from "@/lib/items/collections";
import {
  adminCollectionCreateBodySchema,
  adminCollectionUpdateBodySchema,
  collectionDeleteBodySchema,
  isDuplicateCollectionNameError,
} from "@/lib/api/collection-requests";

/** GET — list user's collections (used on the saved page + move dialog). */
export async function GET() {
  return runAdminRoute(async (user) => {
    await upsertAppUser(user);
    const collections = await listCollections(user.id);
    return adminJson({ collections });
  });
}

/** POST — create a new collection. */
export async function POST(req: Request) {
  return runAdminRoute(async (user) => {
    await upsertAppUser(user);

    const parsed = await parseJsonRequestBody(req, adminCollectionCreateBodySchema, {
      envelope: "ok",
    });
    if (!parsed.ok) return parsed.response;

    try {
      const collection = await createCollection({
        userId: user.id,
        ...parsed.data,
      });
      return adminJson({ collection });
    } catch (err) {
      if (isDuplicateCollectionNameError(err)) {
        return adminError("duplicate_name", 409);
      }
      console.error("[api/admin/collections POST] failed", err);
      return adminError("server_error", 500);
    }
  });
}

/** PATCH — rename / pin / unpin. */
export async function PATCH(req: Request) {
  return runAdminRoute(async (user) => {
    const parsed = await parseJsonRequestBody(req, adminCollectionUpdateBodySchema, {
      envelope: "ok",
    });
    if (!parsed.ok) return parsed.response;

    try {
      const ok = await updateCollection({
        userId: user.id,
        ...parsed.data,
      });
      if (!ok) return adminError("not_found", 404);
      return adminOk();
    } catch (err) {
      console.error("[api/admin/collections PATCH] failed", err);
      return adminError("server_error", 500);
    }
  });
}

/** DELETE — remove a collection. Saves get reparented to inbox (SET NULL). */
export async function DELETE(req: Request) {
  return runAdminRoute(async (user) => {
    const parsed = await parseJsonRequestBody(req, collectionDeleteBodySchema, {
      envelope: "ok",
      includeIssues: false,
    });
    if (!parsed.ok) return parsed.response;

    const ok = await deleteCollection(user.id, parsed.data.id);
    if (!ok) return adminError("not_found", 404);
    return adminOk();
  });
}
