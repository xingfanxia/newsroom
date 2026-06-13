/**
 * /api/v1/collections — Bearer-gated CRUD over saved_collections.
 *
 * Mirrors the admin-cookie-gated /api/admin/collections surface but
 * validates via Bearer token instead. Same underlying helpers so
 * behavior is identical.
 *
 * GET     → list caller's collections
 * POST    → create { name, name_cjk?, pinned? }
 * PATCH   → update  { id, name?, name_cjk?, pinned? }
 * DELETE  → delete  { id }   (cascade-reparents saves to inbox)
 */
import {
  runV1Route,
  v1Error,
  v1Json,
  v1ServerError,
} from "@/lib/api/v1-route";
import {
  createCollectionRoutePayload,
  deleteCollectionRoutePayload,
  listCollectionRoutePayload,
  updateCollectionRoutePayload,
} from "@/lib/api/collection-routes";
import { upsertAppUser } from "@/lib/auth/session";
import {
  collectionDeleteBodySchema,
  v1CollectionCreateBodySchema,
  v1CollectionUpdateBodySchema,
} from "@/lib/api/collection-requests";
import { parseJsonRequestBody } from "@/lib/api/json-body";

export async function GET(req: Request) {
  return runV1Route(req, async (user) => {
    try {
      await upsertAppUser(user);
      return v1Json(await listCollectionRoutePayload(user.id));
    } catch (err) {
      return v1ServerError("api/v1/collections GET", err);
    }
  });
}

export async function POST(req: Request) {
  return runV1Route(req, async (user) => {
    const parsed = await parseJsonRequestBody(
      req,
      v1CollectionCreateBodySchema,
      {
        envelope: "plain",
      },
    );
    if (!parsed.ok) return parsed.response;

    try {
      await upsertAppUser(user);
      const result = await createCollectionRoutePayload({
        userId: user.id,
        ...parsed.data,
      });
      if (!result.ok) return v1Error(result.error, result.status);
      return v1Json(result.payload);
    } catch (err) {
      return v1ServerError("api/v1/collections POST", err);
    }
  });
}

export async function PATCH(req: Request) {
  return runV1Route(req, async (user) => {
    const parsed = await parseJsonRequestBody(
      req,
      v1CollectionUpdateBodySchema,
      {
        envelope: "plain",
      },
    );
    if (!parsed.ok) return parsed.response;

    try {
      const result = await updateCollectionRoutePayload({
        userId: user.id,
        ...parsed.data,
      });
      if (!result.ok) return v1Error(result.error, result.status);
      return v1Json({ ok: true });
    } catch (err) {
      return v1ServerError("api/v1/collections PATCH", err);
    }
  });
}

export async function DELETE(req: Request) {
  return runV1Route(req, async (user) => {
    const parsed = await parseJsonRequestBody(req, collectionDeleteBodySchema, {
      envelope: "plain",
      includeIssues: false,
    });
    if (!parsed.ok) return parsed.response;

    try {
      const result = await deleteCollectionRoutePayload(user.id, parsed.data.id);
      if (!result.ok) return v1Error(result.error, result.status);
      return v1Json({ ok: true });
    } catch (err) {
      return v1ServerError("api/v1/collections DELETE", err);
    }
  });
}
