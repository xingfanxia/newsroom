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
  v1Json,
  v1RouteResult,
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
    await upsertAppUser(user);
    return v1Json(await listCollectionRoutePayload(user.id));
  }, { serverErrorLabel: "api/v1/collections GET" });
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

    await upsertAppUser(user);
    const result = await createCollectionRoutePayload({
      userId: user.id,
      ...parsed.data,
    });
    return v1RouteResult(result, v1Json);
  }, { serverErrorLabel: "api/v1/collections POST" });
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

    const result = await updateCollectionRoutePayload({
      userId: user.id,
      ...parsed.data,
    });
    return v1RouteResult(result, () => v1Json({ ok: true }));
  }, { serverErrorLabel: "api/v1/collections PATCH" });
}

export async function DELETE(req: Request) {
  return runV1Route(req, async (user) => {
    const parsed = await parseJsonRequestBody(req, collectionDeleteBodySchema, {
      envelope: "plain",
      includeIssues: false,
    });
    if (!parsed.ok) return parsed.response;

    const result = await deleteCollectionRoutePayload(user.id, parsed.data.id);
    return v1RouteResult(result, () => v1Json({ ok: true }));
  }, { serverErrorLabel: "api/v1/collections DELETE" });
}
