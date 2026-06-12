/**
 * GET /api/public/dailies — Daily column index (discovery).
 *
 * Returns recent daily-column rows in reverse chronological order. Useful for
 * an agent to enumerate "which dates have columns" without downloading every
 * body. Returns only the metadata (date / generated_at / title / theme_tag).
 *
 * take: 1..180, default 30. Strict 400 on out-of-range.
 */
import { publicRateLimit } from "@/lib/rate-limit/public";
import {
  computeEtag,
  ifNoneMatch,
  notModified,
  publicError,
  publicJson,
} from "@/lib/api/public-helpers";
import {
  dailyColumnIndexQuerySchema,
  listDailyColumnIndexRows,
  publicDailyColumnIndexEtagSignal,
  toPublicDailyColumnIndex,
} from "@/lib/api/daily-columns";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const limited = publicRateLimit(req, {
    family: "public-dailies",
    windowMs: 60_000,
    max: 300,
  });
  if (limited) return limited;

  const url = new URL(req.url);
  const parsed = dailyColumnIndexQuerySchema.safeParse(
    Object.fromEntries(url.searchParams.entries()),
  );
  if (!parsed.success) {
    return publicError(
      `invalid_query: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
      400,
    );
  }
  const q = parsed.data;

  try {
    const rows = await listDailyColumnIndexRows(q);
    const body = toPublicDailyColumnIndex(rows);
    const etag = computeEtag(
      "public-dailies",
      publicDailyColumnIndexEtagSignal(rows, q),
    );
    if (ifNoneMatch(req, etag)) return notModified(etag);

    return publicJson(body, etag, {
      sMaxAge: 300,
      staleWhileRevalidate: 3600,
    });
  } catch (err) {
    console.error("[api/public/dailies] failed", err);
    return publicError("server_error", 500);
  }
}
