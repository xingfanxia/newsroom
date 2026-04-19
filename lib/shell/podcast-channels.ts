import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { items, sources } from "@/db/schema";
import type { ChannelPill } from "@/app/[locale]/podcasts/_channel-pills";

/**
 * Lists enabled podcast-group sources with their all-time item counts —
 * drives the channel-filter pill row on /podcasts.
 */
export async function getPodcastChannels(): Promise<ChannelPill[]> {
  const rows = await db().execute(sql`
    SELECT
      ${sources.id} AS id,
      ${sources.nameEn} AS name_en,
      ${sources.nameZh} AS name_zh,
      (SELECT count(*)::int FROM ${items}
         WHERE ${items.sourceId} = ${sources.id}) AS total
    FROM ${sources}
    WHERE ${sources.group} = 'podcast'
      AND ${sources.enabled} = true
    ORDER BY total DESC
  `);

  return rows.map((r) => ({
    id: String(r.id),
    nameEn: String(r.name_en ?? r.id),
    nameZh: String(r.name_zh ?? r.name_en ?? r.id),
    count: Number(r.total) || 0,
  }));
}
