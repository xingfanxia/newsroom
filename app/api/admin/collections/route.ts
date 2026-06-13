import { upsertAppUser } from "@/lib/auth/session";
import {
  adminError,
  adminJson,
  adminOk,
  adminServerError,
  runAdminRoute,
} from "@/lib/api/admin-route";
import { parseJsonRequestBody } from "@/lib/api/json-body";
import {
  createCollectionRoutePayload,
  deleteCollectionRoutePayload,
  listCollectionRoutePayload,
  updateCollectionRoutePayload,
} from "@/lib/api/collection-routes";
import {
  adminCollectionCreateBodySchema,
  adminCollectionUpdateBodySchema,
  collectionDeleteBodySchema,
} from "@/lib/api/collection-requests";

/** GET — list user's collections (used on the saved page + move dialog). */
export async function GET() {
  return runAdminRoute(async (user) => {
    await upsertAppUser(user);
    const { collections } = await listCollectionRoutePayload(user.id);
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
      const result = await createCollectionRoutePayload({
        userId: user.id,
        ...parsed.data,
      });
      if (!result.ok) return adminError(result.error, result.status);
      return adminJson(result.payload);
    } catch (err) {
      return adminServerError("api/admin/collections POST", err);
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
      const result = await updateCollectionRoutePayload({
        userId: user.id,
        ...parsed.data,
      });
      if (!result.ok) return adminError(result.error, result.status);
      return adminOk();
    } catch (err) {
      return adminServerError("api/admin/collections PATCH", err);
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

    try {
      const result = await deleteCollectionRoutePayload(user.id, parsed.data.id);
      if (!result.ok) return adminError(result.error, result.status);
      return adminOk();
    } catch (err) {
      return adminServerError("api/admin/collections DELETE", err);
    }
  });
}
