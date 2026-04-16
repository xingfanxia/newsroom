import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { sources, sourceHealth } from "@/db/schema";
import { sourceCatalog } from "@/lib/sources/catalog";
import type { Source } from "@/lib/types";

export type LiveSource = Source & {
  health: {
    status: "ok" | "warning" | "error" | "pending";
    lastFetchedAt: string | null;
    lastSuccessAt: string | null;
    lastError: string | null;
    lastItemsCount: number;
    totalItemsCount: number;
    consecutiveFailures: number;
  };
};

export async function getLiveSources(): Promise<LiveSource[]> {
  if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) {
    return fallbackFromCatalog();
  }

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
        hStatus: sourceHealth.status,
        hLastFetched: sourceHealth.lastFetchedAt,
        hLastSuccess: sourceHealth.lastSuccessAt,
        hError: sourceHealth.lastError,
        hLastCount: sourceHealth.lastItemsCount,
        hTotalCount: sourceHealth.totalItemsCount,
        hFailures: sourceHealth.consecutiveFailures,
      })
      .from(sources)
      .leftJoin(sourceHealth, sql`${sources.id} = ${sourceHealth.sourceId}`);

    if (rows.length === 0) return fallbackFromCatalog();

    return rows.map(
      (r): LiveSource => ({
        id: r.id,
        name: { en: r.nameEn, zh: r.nameZh },
        url: r.url,
        kind: r.kind,
        group: r.group,
        locale: r.locale,
        cadence: r.cadence,
        priority: r.priority as 1 | 2 | 3,
        tags: r.tags,
        enabled: r.enabled,
        notes: r.notes ?? undefined,
        health: {
          status: r.hStatus ?? "pending",
          lastFetchedAt: r.hLastFetched?.toISOString() ?? null,
          lastSuccessAt: r.hLastSuccess?.toISOString() ?? null,
          lastError: r.hError,
          lastItemsCount: r.hLastCount ?? 0,
          totalItemsCount: r.hTotalCount ?? 0,
          consecutiveFailures: r.hFailures ?? 0,
        },
      }),
    );
  } catch (err) {
    console.warn(
      "[live-sources] falling back to catalog:",
      err instanceof Error ? err.message : err,
    );
    return fallbackFromCatalog();
  }
}

function fallbackFromCatalog(): LiveSource[] {
  return sourceCatalog.map((s) => ({
    ...s,
    health: {
      status: "pending",
      lastFetchedAt: null,
      lastSuccessAt: null,
      lastError: null,
      lastItemsCount: 0,
      totalItemsCount: 0,
      consecutiveFailures: 0,
    },
  }));
}

export function liveSourcesByGroup(all: LiveSource[]): Map<string, LiveSource[]> {
  const m = new Map<string, LiveSource[]>();
  for (const s of all) {
    if (!m.has(s.group)) m.set(s.group, []);
    m.get(s.group)!.push(s);
  }
  return m;
}
