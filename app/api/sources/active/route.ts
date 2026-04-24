import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { sources } from "@/db/schema";

export const revalidate = 300;

/**
 * Public list of enabled sources for the in-app source picker. Returns only
 * the fields needed to render + filter (id, names, kind, group). URLs and
 * notes are omitted — the bearer-gated /api/v1/sources still carries the
 * full catalog + health for external agents.
 */
export async function GET() {
  try {
    const client = db();
    const rows = await client
      .select({
        id: sources.id,
        nameEn: sources.nameEn,
        nameZh: sources.nameZh,
        kind: sources.kind,
        group: sources.group,
        locale: sources.locale,
      })
      .from(sources)
      .where(eq(sources.enabled, true))
      .orderBy(asc(sources.group), asc(sources.nameEn));
    return Response.json({
      sources: rows.map((r) => ({
        id: r.id,
        name_en: r.nameEn,
        name_zh: r.nameZh,
        kind: r.kind,
        group: r.group,
        locale: r.locale,
      })),
      total: rows.length,
    });
  } catch (err) {
    console.error("[api/sources/active] failed", err);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
