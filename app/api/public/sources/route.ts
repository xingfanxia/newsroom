/**
 * GET /api/public/sources — Anonymous source catalog with live health.
 *
 * Mirrors /api/v1/sources but drops `last_error` (internal diagnostic) and
 * `last_fetched_at` (operational; not interesting publicly). Useful for
 * "does AX Radar cover X publisher?" before issuing a filtered feed query.
 */
import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { sources, sourceHealth } from "@/db/schema";
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

export async function GET(req: Request) {
  const limited = publicRateLimit(req, {
    family: "public-sources",
    windowMs: 60_000,
    max: 300,
  });
  if (limited) return limited;

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
        curated: sources.curated,
        status: sourceHealth.status,
        lastSuccessAt: sourceHealth.lastSuccessAt,
        consecutiveFailures: sourceHealth.consecutiveFailures,
        totalItemsCount: sourceHealth.totalItemsCount,
      })
      .from(sources)
      .leftJoin(sourceHealth, eq(sources.id, sourceHealth.sourceId))
      .orderBy(asc(sources.priority), asc(sources.id));

    const body = {
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
        curated: r.curated ?? false,
        health: {
          status: r.status ?? "pending",
          last_success_at: r.lastSuccessAt?.toISOString() ?? null,
          consecutive_failures: r.consecutiveFailures ?? 0,
          total_items_count: r.totalItemsCount ?? 0,
        },
      })),
      total: rows.length,
    };

    const etag = computeEtag(
      "public-sources",
      etagSignal({
        count: rows.length,
        latest_success: rows
          .map((r) => r.lastSuccessAt?.toISOString() ?? "")
          .sort()
          .pop() ?? "",
      }),
    );
    if (ifNoneMatch(req, etag)) return notModified(etag);

    // Catalog rarely changes — long stale-while-revalidate.
    return publicJson(body, etag, {
      sMaxAge: 300,
      staleWhileRevalidate: 3600,
    });
  } catch (err) {
    console.error("[api/public/sources] failed", err);
    return publicError("server_error", 500);
  }
}
