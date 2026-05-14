/**
 * GET /api/public/dailies — Daily column index (discovery).
 *
 * Returns recent daily-column rows in reverse chronological order. Useful for
 * an agent to enumerate "which dates have columns" without downloading every
 * body. Returns only the metadata (date / generated_at / title / theme_tag).
 *
 * take: 1..180, default 30. Strict 400 on out-of-range.
 */
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { newsletters } from "@/db/schema";
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

const querySchema = z.object({
  take: z.coerce.number().int().min(1).max(180).optional().default(30),
  locale: z.enum(["zh", "en"]).optional().default("zh"),
});

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  const limited = publicRateLimit(req, {
    family: "public-dailies",
    windowMs: 60_000,
    max: 300,
  });
  if (limited) return limited;

  const url = new URL(req.url);
  const parsed = querySchema.safeParse(
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
    const client = db();
    const rows = await client
      .select({
        id: newsletters.id,
        columnTitle: newsletters.columnTitle,
        columnThemeTag: newsletters.columnThemeTag,
        storyCount: newsletters.storyCount,
        periodStart: newsletters.periodStart,
        publishedAt: newsletters.publishedAt,
      })
      .from(newsletters)
      .where(
        sql`${newsletters.kind} = 'daily'
          AND ${newsletters.locale} = ${q.locale}
          AND ${newsletters.columnTitle} IS NOT NULL`,
      )
      .orderBy(sql`${newsletters.periodStart} DESC`)
      .limit(q.take);

    const body = {
      count: rows.length,
      items: rows.map((r) => ({
        id: r.id,
        date: dateKey(r.periodStart),
        generated_at: r.publishedAt.toISOString(),
        title: r.columnTitle,
        theme_tag: r.columnThemeTag,
        story_count: r.storyCount,
      })),
    };
    const etag = computeEtag(
      "public-dailies",
      etagSignal({
        count: rows.length,
        first_id: rows[0]?.id ?? "",
        first_gen: rows[0]?.publishedAt.toISOString() ?? "",
        locale: q.locale,
        take: q.take,
      }),
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
