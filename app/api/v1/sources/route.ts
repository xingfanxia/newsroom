/**
 * GET /api/v1/sources — Bearer-gated source catalog with live health.
 *
 * Returns every row in `sources` joined with `source_health`, so agents
 * can check coverage before firing a query ("is there anything from
 * Dwarkesh in the last 48h?"). Disabled sources are included with
 * enabled=false — the operator may want to see what's in the catalog
 * even if the adapter is paused.
 */
import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { sources, sourceHealth } from "@/db/schema";
import { requireApiToken } from "@/lib/auth/api-token";

export async function GET(req: Request) {
  const auth = await requireApiToken(req);
  if (auth instanceof Response) return auth;

  try {
    const client = db();
    const rows = await client
      .select({
        id: sources.id,
        nameEn: sources.nameEn,
        nameZh: sources.nameZh,
        url: sources.url,
        kind: sources.kind,
        group: sources.group,
        locale: sources.locale,
        cadence: sources.cadence,
        priority: sources.priority,
        tags: sources.tags,
        enabled: sources.enabled,
        notes: sources.notes,
        status: sourceHealth.status,
        lastFetchedAt: sourceHealth.lastFetchedAt,
        lastSuccessAt: sourceHealth.lastSuccessAt,
        consecutiveFailures: sourceHealth.consecutiveFailures,
        lastItemsCount: sourceHealth.lastItemsCount,
        totalItemsCount: sourceHealth.totalItemsCount,
        lastError: sourceHealth.lastError,
      })
      .from(sources)
      .leftJoin(sourceHealth, eq(sources.id, sourceHealth.sourceId))
      .orderBy(asc(sources.priority), asc(sources.id));

    return Response.json({
      sources: rows.map((r) => ({
        id: r.id,
        name_en: r.nameEn,
        name_zh: r.nameZh,
        url: r.url,
        kind: r.kind,
        group: r.group,
        locale: r.locale,
        cadence: r.cadence,
        priority: r.priority,
        tags: r.tags,
        enabled: r.enabled,
        notes: r.notes,
        health: {
          status: r.status ?? "pending",
          last_fetched_at: r.lastFetchedAt?.toISOString() ?? null,
          last_success_at: r.lastSuccessAt?.toISOString() ?? null,
          consecutive_failures: r.consecutiveFailures ?? 0,
          last_items_count: r.lastItemsCount ?? 0,
          total_items_count: r.totalItemsCount ?? 0,
          last_error: r.lastError,
        },
      })),
      total: rows.length,
    });
  } catch (err) {
    console.error("[api/v1/sources] failed", err);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
