/**
 * Daily AI column writer — 卡兹克-voice 2500-4500 字 narrative on the day's
 * 严选 ∪ 热点聚合 selection. Replaces the structured `runNewsletterBatch("daily")`
 * format (legacy fields headline/overview/highlights/commentary stay populated
 * for monthly only).
 *
 * Flow: select pool → render user prompt → generateStructured against
 * gpt-5.5-standard → run L1-L2 self-check → upsert into newsletters with
 * column_* fields → log QC hits to column_qc_log if any.
 */
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { newsletters, columnQcLog } from "@/db/schema";
import { generateStructured, profiles } from "@/lib/llm";
import { loadDailyColumnPrompt } from "@/lib/llm/prompts/load";
import { selectDailyColumnPool, type SelectedRow } from "./select";
import { runColumnSelfCheck } from "./qc/self-check";

const dailyColumnSchema = z.object({
  title: z
    .string()
    .min(1)
    .max(80)
    .describe(
      "≤24 字 concrete + opinionated title (Stratechery-register, not category-name). No marketing verbs.",
    ),
  summary_md: z
    .string()
    .min(200)
    .describe(
      "Numbered 1-5 markdown list. Each entry 60-120 字: title — quick take with judgment — [#item-id].",
    ),
  narrative_md: z
    .string()
    .min(2500)
    .describe(
      "3500-6000 字 long-form analysis. USE markdown structure: ## subheadings (recommended 2-3 主题块), ### sub-subheadings, lists, blockquotes, **bold**, *italic*. References summary as 第 N 件 (callback). At least one industry/historical/cultural reference where it surfaces naturally.",
    ),
  featured_item_ids: z
    .array(z.number())
    .min(1)
    .max(3)
    .describe("Item IDs given deep treatment in narrative_md."),
  theme_tag: z
    .string()
    .min(1)
    .max(30)
    .describe("≤10 字 day theme (e.g., 算力合同战 / Agentic 编码新基线 / 监管正面碰撞)."),
});

export type DailyColumnReport = {
  generated: { newsletterId: number } | null;
  skipped: string[];
  storyCount: number;
  qcHits: number;
  durationMs: number;
};

export async function runDailyColumn(
  opts: { now?: Date; force?: boolean } = {},
): Promise<DailyColumnReport> {
  const started = Date.now();
  const now = opts.now ?? new Date();
  const skipped: string[] = [];
  const client = db();

  const pool = await selectDailyColumnPool(now);
  if (pool.rows.length === 0) {
    skipped.push(pool.skipReason ?? "empty");
    return {
      generated: null,
      skipped,
      storyCount: 0,
      qcHits: 0,
      durationMs: Date.now() - started,
    };
  }

  if (!opts.force) {
    const existing = await client
      .select({ id: newsletters.id })
      .from(newsletters)
      .where(
        sql`${newsletters.kind} = 'daily'
          AND ${newsletters.locale} = 'zh'
          AND ${newsletters.periodStart} = ${pool.windowStart.toISOString()}::timestamptz
          AND ${newsletters.columnTitle} IS NOT NULL`,
      )
      .limit(1);
    if (existing.length > 0) {
      skipped.push("exists");
      return {
        generated: null,
        skipped,
        storyCount: pool.rows.length,
        qcHits: 0,
        durationMs: Date.now() - started,
      };
    }
  }

  const userPrompt = renderItemsForPrompt(pool.rows);
  const systemPrompt = loadDailyColumnPrompt();

  const result = await generateStructured({
    ...profiles.score,
    task: "daily-column",
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
    schema: dailyColumnSchema,
    schemaName: "DailyColumn",
    maxTokens: 20000,
  });

  const draft = result.data;
  const qc = runColumnSelfCheck({
    title: draft.title,
    summary_md: draft.summary_md,
    narrative_md: draft.narrative_md,
  });

  const inserted = await client
    .insert(newsletters)
    .values({
      kind: "daily",
      locale: "zh",
      periodStart: pool.windowStart,
      periodEnd: pool.windowEnd,
      columnTitle: draft.title,
      columnSummaryMd: draft.summary_md,
      columnNarrativeMd: draft.narrative_md,
      columnFeaturedItemIds: draft.featured_item_ids,
      columnThemeTag: draft.theme_tag,
      itemIds: pool.rows.map((r) => r.id),
      storyCount: pool.rows.length,
    })
    .onConflictDoUpdate({
      target: [newsletters.kind, newsletters.locale, newsletters.periodStart],
      set: {
        columnTitle: draft.title,
        columnSummaryMd: draft.summary_md,
        columnNarrativeMd: draft.narrative_md,
        columnFeaturedItemIds: draft.featured_item_ids,
        columnThemeTag: draft.theme_tag,
        itemIds: pool.rows.map((r) => r.id),
        storyCount: pool.rows.length,
        publishedAt: new Date(),
      },
    })
    .returning({ id: newsletters.id });

  const newsletterId = inserted[0]!.id;

  if (qc.hits.length > 0) {
    await client.insert(columnQcLog).values({
      newsletterId,
      l1Pass: qc.l1Pass,
      l2Pass: qc.l2Pass,
      hits: qc.hits,
    });
  }

  return {
    generated: { newsletterId },
    skipped,
    storyCount: pool.rows.length,
    qcHits: qc.hits.length,
    durationMs: Date.now() - started,
  };
}

/**
 * Render selected items as a prompt-friendly bag. Includes coverage count
 * (so the writer can see "5 sources covered this") + curated flag (so the
 * writer can lean on operator-vouched-for sources). Items with the same
 * canonical title prefix are flagged as potential dupes — Stage A recall
 * sometimes leaks near-duplicates and the writer should merge in its take.
 */
function renderItemsForPrompt(rows: SelectedRow[]): string {
  const lines = rows.map((r) => {
    const title = r.canonicalTitleZh ?? r.titleZh ?? r.titleEn ?? r.title;
    const summary = r.summaryZh ?? r.summaryEn ?? "";
    const note = r.noteZh ?? r.noteEn ?? "";
    const tagBag = (r.tags ?? {}) as {
      capabilities?: string[];
      entities?: string[];
      topics?: string[];
    };
    const tagsStr = [
      ...(tagBag.entities ?? []),
      ...(tagBag.topics ?? []),
      ...(tagBag.capabilities ?? []),
    ]
      .slice(0, 5)
      .join(", ");
    const meta = [
      r.tier ? `tier=${r.tier}` : null,
      `imp=${r.importance ?? "?"}`,
      r.coverage > 1 ? `coverage=${r.coverage}` : null,
      r.fromCurated ? "严选" : null,
    ]
      .filter(Boolean)
      .join(", ");
    return `[#${r.id}] (${meta}) ${title}
  tags: ${tagsStr}
  summary: ${summary}
  ${note ? `editor_note: ${note}` : ""}`.trim();
  });

  return `<window kind="daily-column" locale="zh" story_count="${rows.length}">
${lines.join("\n\n")}
</window>

注意，上方 items 中可能有同一事件的多源覆盖（不同 cluster_id 但讲同一件事），如果你看到比如 3 条都是 Google 投资 Anthropic 的报道，把它们合并成 summary 里的一条编号项，narrative 里也作为一个事件深聊。你的任务是写 1 篇 5-7 分钟的日报，不是写新闻摘要的列表。`;
}
