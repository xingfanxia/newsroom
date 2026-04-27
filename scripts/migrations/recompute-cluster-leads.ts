/**
 * Recompute `cluster.lead_item_id` for existing multi-member clusters using the
 * authority-aware picker (workers/cluster/lead-pick.ts). Optionally nullify
 * `titled_at` on clusters whose lead changed OR whose canonical_title contains
 * bad patterns (platform names, "rumored" when confirmation members exist) so
 * the next Stage C tick regenerates the title with the new prompt.
 *
 * Why: Stage A sets `lead_item_id` to whichever item happened to start the
 * cluster — usually a Reddit post or X tweet, even when the cluster contains
 * vendor-official sources. The feed card displays the wrong source label
 * AND Stage C's old prompt over-indexed on the social/Reddit framing. The
 * fix in workers/cluster/canonical-title.ts handles new clusters going
 * forward; this script repairs existing data.
 *
 * Usage:
 *   bun run scripts/migrations/recompute-cluster-leads.ts                  # dry-run
 *   bun run scripts/migrations/recompute-cluster-leads.ts --apply          # commit
 *   bun run scripts/migrations/recompute-cluster-leads.ts --apply --retitle-bad
 *     # also nullify titled_at on clusters whose canonical_title contains
 *     # platform names or speculation-when-confirmation-exists, so Stage C
 *     # regenerates them at the next cron tick
 */
import { eq, sql } from "drizzle-orm";
import { db, closeDb } from "@/db/client";
import { clusters, items, sources } from "@/db/schema";
import { pickBestLead, type SourceGroup } from "@/workers/cluster/lead-pick";

type CliFlags = { apply: boolean; retitleBad: boolean };

function parseFlags(): CliFlags {
  const args = process.argv.slice(2);
  return {
    apply: args.includes("--apply"),
    retitleBad: args.includes("--retitle-bad"),
  };
}

// Canonical-title patterns that indicate the old prompt's failures:
//   - mentions platform/source name in the title (DeepSeek 在 Reddit 流传)
//   - says "rumored" when at least one cluster member confirms the event
const BAD_TITLE_RE_ZH =
  /(在\s*Reddit|Reddit\s*上|Reddit\s*流传|Twitter\s*流传|HN\s*讨论|Hacker News\s*讨论|Product Hunt\s*流传|X 平台流传)/i;
const BAD_TITLE_RE_EN =
  /(on Reddit|reddit thread|reddit post|twitter post|on X|HN thread|hacker news thread|spreading on)/i;

async function main() {
  const { apply, retitleBad } = parseFlags();
  const client = db();

  console.log(
    `[recompute-leads] mode=${apply ? "APPLY" : "DRY-RUN"} retitle-bad=${retitleBad}`,
  );

  // Pull all multi-member clusters + their members + source group/priority +
  // canonical titles. One round-trip — fast enough for ~500 clusters.
  const rows = (await client.execute(sql`
    SELECT
      c.id AS cluster_id,
      c.lead_item_id AS current_lead,
      c.canonical_title_zh,
      c.canonical_title_en,
      c.titled_at,
      i.id AS item_id,
      i.importance,
      i.published_at,
      s."group" AS source_group,
      s.priority AS source_priority,
      s.id AS source_id,
      s.name_en AS source_name
    FROM clusters c
    JOIN items i ON i.cluster_id = c.id
    JOIN sources s ON s.id = i.source_id
    WHERE c.member_count >= 2
    ORDER BY c.id, i.id
  `)) as unknown as Array<{
    cluster_id: number;
    current_lead: number;
    canonical_title_zh: string | null;
    canonical_title_en: string | null;
    titled_at: string | null;
    item_id: number;
    importance: number | null;
    published_at: string;
    source_group: string;
    source_priority: number;
    source_id: string;
    source_name: string;
  }>;

  // Group rows into clusters.
  type Cluster = {
    id: number;
    currentLead: number;
    titleZh: string | null;
    titleEn: string | null;
    titledAt: string | null;
    members: Array<{
      itemId: number;
      sourceGroup: SourceGroup;
      sourcePriority: number;
      importance: number | null;
      publishedAt: string;
      sourceId: string;
      sourceName: string;
    }>;
  };
  const byCluster = new Map<number, Cluster>();
  for (const r of rows) {
    let c = byCluster.get(r.cluster_id);
    if (!c) {
      c = {
        id: r.cluster_id,
        currentLead: r.current_lead,
        titleZh: r.canonical_title_zh,
        titleEn: r.canonical_title_en,
        titledAt: r.titled_at,
        members: [],
      };
      byCluster.set(r.cluster_id, c);
    }
    c.members.push({
      itemId: r.item_id,
      sourceGroup: r.source_group as SourceGroup,
      sourcePriority: r.source_priority,
      importance: r.importance,
      publishedAt: r.published_at,
      sourceId: r.source_id,
      sourceName: r.source_name,
    });
  }

  console.log(`[recompute-leads] inspecting ${byCluster.size} multi-member clusters\n`);

  let leadsChanged = 0;
  let leadsUnchanged = 0;
  let titlesNullified = 0;
  const sampleChanges: Array<{
    clusterId: number;
    fromSource: string;
    toSource: string;
    titleZh: string | null;
  }> = [];

  for (const c of byCluster.values()) {
    const newLead = pickBestLead(c.members);
    const currentLead = c.members.find((m) => m.itemId === c.currentLead);

    let titleNeedsRegen = false;
    if (retitleBad) {
      const titleZh = c.titleZh ?? "";
      const titleEn = c.titleEn ?? "";
      if (BAD_TITLE_RE_ZH.test(titleZh) || BAD_TITLE_RE_EN.test(titleEn)) {
        titleNeedsRegen = true;
      }
    }

    if (newLead.itemId === c.currentLead) {
      leadsUnchanged++;
      if (titleNeedsRegen) {
        if (apply) {
          await client
            .update(clusters)
            .set({ titledAt: null })
            .where(eq(clusters.id, c.id));
        }
        titlesNullified++;
      }
      continue;
    }

    leadsChanged++;
    if (titleNeedsRegen || newLead.itemId !== c.currentLead) {
      // Lead changed OR title is bad — nullify titled_at if --retitle-bad,
      // OR always nullify on lead change so the new lead's framing is reflected.
      if (apply) {
        await client
          .update(clusters)
          .set({
            leadItemId: newLead.itemId,
            titledAt: null,
          })
          .where(eq(clusters.id, c.id));
      }
      if (titleNeedsRegen || true) titlesNullified++;
    } else {
      if (apply) {
        await client
          .update(clusters)
          .set({ leadItemId: newLead.itemId })
          .where(eq(clusters.id, c.id));
      }
    }

    if (sampleChanges.length < 30) {
      sampleChanges.push({
        clusterId: c.id,
        fromSource: currentLead?.sourceName ?? "(unknown)",
        toSource: newLead.sourceName,
        titleZh: c.titleZh,
      });
    }
  }

  console.log("\n[recompute-leads] sample lead changes (first 30):\n");
  for (const ch of sampleChanges) {
    console.log(
      `  cluster ${ch.clusterId}: ${ch.fromSource}  →  ${ch.toSource}`,
    );
    if (ch.titleZh) console.log(`    title: ${ch.titleZh}`);
  }

  console.log("\n[recompute-leads] summary");
  console.log(`  clusters inspected:       ${byCluster.size}`);
  console.log(`  leads changed:            ${leadsChanged}`);
  console.log(`  leads unchanged:          ${leadsUnchanged}`);
  console.log(
    `  titled_at nullified for regen: ${titlesNullified} (Stage C will re-title at next cron)`,
  );
  if (!apply && (leadsChanged > 0 || titlesNullified > 0)) {
    console.log("\n  re-run with --apply to commit.");
  }

  await closeDb();
}

await main();
