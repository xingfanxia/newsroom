/**
 * GET /api/public/events/:id/members — Anonymous, rate-limited, ETag-aware.
 *
 * Same payload as /api/events/:id/members (the UI-internal endpoint) but
 * under /api/public/* with rate limit + CORS + ETag so it composes cleanly
 * with the documented public surface.
 *
 * Unknown cluster_id returns 200 with empty members[] so consumer agents can
 * degrade without a special error path — same convention as v1.
 */
import { z } from "zod";
import { toEventMemberApiItems } from "@/lib/api/event-members";
import { getEventMembers } from "@/lib/items/live";
import { publicRateLimit } from "@/lib/rate-limit/public";
import {
  computeEtag,
  etagSignal,
  ifNoneMatch,
  notModified,
  publicError,
  publicJson,
} from "@/lib/api/public-helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const idSchema = z.coerce.number().int().positive();
const localeSchema = z.enum(["zh", "en"]).default("en");

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const limited = publicRateLimit(req, {
    family: "public-events",
    windowMs: 60_000,
    max: 600,
  });
  if (limited) return limited;

  const { id: idRaw } = await ctx.params;
  const parsedId = idSchema.safeParse(idRaw);
  if (!parsedId.success) return publicError("invalid_id", 400);

  const url = new URL(req.url);
  const parsedLocale = localeSchema.safeParse(
    url.searchParams.get("locale") ?? "en",
  );
  if (!parsedLocale.success) return publicError("invalid_locale", 400);

  try {
    const members = await getEventMembers(parsedId.data, parsedLocale.data);
    const body = {
      cluster_id: parsedId.data,
      members: toEventMemberApiItems(members),
      total: members.length,
    };
    const etag = computeEtag(
      "public-event",
      etagSignal({
        cluster_id: parsedId.data,
        n: members.length,
        last_at: members[members.length - 1]?.publishedAt ?? "",
      }),
    );
    if (ifNoneMatch(req, etag)) return notModified(etag);
    return publicJson(body, etag, {
      sMaxAge: 180,
      staleWhileRevalidate: 900,
    });
  } catch (err) {
    console.error("[api/public/events/:id/members] failed", err);
    return publicError("server_error", 500);
  }
}
