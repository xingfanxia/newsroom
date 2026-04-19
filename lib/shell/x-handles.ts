import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { items, sources } from "@/db/schema";
import type { XHandleEntry } from "@/components/x-monitor/handles-sidebar";

/**
 * Summary rows for the X Monitor sidebar: every enabled x-api source +
 * its posts-in-the-last-24h count + all-time tally. Drives the left-column
 * selector so a click narrows the main feed to one handle.
 */
export async function getXHandles(): Promise<XHandleEntry[]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db().execute(sql`
    SELECT
      ${sources.id} AS id,
      ${sources.url} AS url,
      ${sources.nameEn} AS name_en,
      ${sources.nameZh} AS name_zh,
      (SELECT count(*)::int FROM ${items}
         WHERE ${items.sourceId} = ${sources.id}
           AND ${items.createdAt} >= ${since}) AS last_24h,
      (SELECT count(*)::int FROM ${items}
         WHERE ${items.sourceId} = ${sources.id}) AS total
    FROM ${sources}
    WHERE ${sources.kind} = 'x-api'
      AND ${sources.enabled} = true
    ORDER BY last_24h DESC, total DESC
  `);

  return rows.map((r) => {
    const url = String(r.url ?? "");
    const match = url.match(/(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})/i);
    const handle = match ? `@${match[1]}` : String(r.id);
    return {
      id: String(r.id),
      handle,
      nameEn: String(r.name_en ?? handle),
      nameZh: String(r.name_zh ?? handle),
      last24h: Number(r.last_24h) || 0,
      total: Number(r.total) || 0,
    };
  });
}
