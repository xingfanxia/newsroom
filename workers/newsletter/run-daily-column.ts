/**
 * Daily AI column writer — friend-readable narrative on the day's
 * 严选 ∪ 热点聚合 selection, with AI HOT (https://aihot.virxact.com)
 * daily report merged in as a must-cover baseline.
 *
 * Flow: select pool → fetch AI HOT daily (graceful, may be null) →
 * render user prompt with optional <aihot-daily> block → generateStructured
 * against DeepSeek V4 Pro → run L1-L2 self-check → upsert into newsletters
 * with column_* + aihot_daily_* fields → log QC hits to column_qc_log if any.
 *
 * Voice rebase 2026-06-10: lib/llm/prompts/daily-column.md now targets
 * friend-readable sharing: accurate, clear, and not report-like.
 */
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { newsletters, columnQcLog } from "@/db/schema";
import { generateStructured, profiles } from "@/lib/llm";
import { loadDailyColumnPrompt } from "@/lib/llm/prompts/load";
import { selectDailyColumnPool, type SelectedRow } from "./select";
import { runColumnSelfCheck } from "./qc/self-check";
import {
  fetchAihotDailyForDate,
  utcYmdFromDate,
  renderAihotDailyForPrompt,
} from "./aihot-daily";
import type { AihotDailyReport } from "@/lib/sources/aihot";

const dailyColumnSchema = z.object({
  title: z.string().min(1).transform((s) =>
    s.length > 80 ? `${s.slice(0, 77)}...` : s,
  ).describe("≤24 字 总标题"),
  summary_md: z.string().min(80).describe("100-200 字 开场白"),
  narrative_md: z
    .string()
    .min(2500)
    .describe("5-8 个 ## 小节, 每节 250-700 字，像给朋友解释当天重点"),
  featured_item_ids: z.array(z.number()).transform((ids) => ids.slice(0, 3)),
  theme_tag: z.string().min(1).transform((s) =>
    s.length > 30 ? `${s.slice(0, 27)}...` : s,
  ),
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

  // ── AI HOT daily (must-cover baseline) — graceful: null on failure ──
  const aihotPayload = await fetchAihotDailyForDate(
    utcYmdFromDate(pool.windowEnd),
  );

  const userPrompt = renderItemsForPrompt(pool.rows, aihotPayload);
  const systemPrompt = loadDailyColumnPrompt();

  const result = await generateStructured({
    ...profiles.score,
    task: "daily-column",
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
    schema: dailyColumnSchema,
    schemaName: "DailyColumn",
    maxTokens: 30000,
  });

  const draft = result.data;
  const title = normalizeDailyOutputText(draft.title);
  const summaryMd = normalizeDailyOutputText(draft.summary_md);
  const narrativeMd = splitDenseParagraphs(normalizeDailyOutputText(draft.narrative_md));
  const featuredItemIds = normalizeFeaturedItemIds(
    draft.featured_item_ids,
    pool.rows,
  );
  const qc = runColumnSelfCheck({
    title,
    summary_md: summaryMd,
    narrative_md: narrativeMd,
  });

  const inserted = await client
    .insert(newsletters)
    .values({
      kind: "daily",
      locale: "zh",
      periodStart: pool.windowStart,
      periodEnd: pool.windowEnd,
      columnTitle: title,
      columnSummaryMd: summaryMd,
      columnNarrativeMd: narrativeMd,
      columnFeaturedItemIds: featuredItemIds,
      columnThemeTag: draft.theme_tag,
      itemIds: pool.rows.map((r) => r.id),
      storyCount: pool.rows.length,
      aihotDailyPayload: aihotPayload ?? null,
      aihotDailyDate: aihotPayload?.date ?? null,
    })
    .onConflictDoUpdate({
      target: [newsletters.kind, newsletters.locale, newsletters.periodStart],
      set: {
        columnTitle: title,
        columnSummaryMd: summaryMd,
        columnNarrativeMd: narrativeMd,
        columnFeaturedItemIds: featuredItemIds,
        columnThemeTag: draft.theme_tag,
        itemIds: pool.rows.map((r) => r.id),
        storyCount: pool.rows.length,
        aihotDailyPayload: aihotPayload ?? null,
        aihotDailyDate: aihotPayload?.date ?? null,
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

export function normalizeFeaturedItemIds(
  modelIds: number[],
  rows: Pick<SelectedRow, "id">[],
): number[] {
  const poolIds = new Set(rows.map((r) => r.id));
  const selected = modelIds
    .filter((id) => poolIds.has(id))
    .filter((id, index, ids) => ids.indexOf(id) === index)
    .slice(0, 3);
  if (selected.length > 0) return selected;
  return rows.slice(0, 3).map((r) => r.id);
}

/**
 * Render selected items as a prompt-friendly bag. Includes coverage count
 * (so the writer can see "5 sources covered this") + curated flag (so the
 * writer can lean on operator-vouched-for sources). Items with the same
 * canonical title prefix are flagged as potential dupes — Stage A recall
 * sometimes leaks near-duplicates and the writer should merge in its take.
 */
function renderItemsForPrompt(
  rows: SelectedRow[],
  aihotDaily: AihotDailyReport | null,
): string {
  const lines = rows.map((r) => {
    const title = r.canonicalTitleZh ?? r.titleZh ?? r.titleEn ?? r.title;
    const summary = normalizeDailyPromptText(r.summaryZh ?? r.summaryEn ?? "");
    const note = normalizeDailyPromptText(r.noteZh ?? r.noteEn ?? "");
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

  const aihotBlock = renderAihotDailyForPrompt(aihotDaily);

  return `<window kind="daily-column" locale="zh" story_count="${rows.length}">
${lines.join("\n\n")}
</window>${aihotBlock ? `\n\n${aihotBlock}` : ""}

注意，上方 <window> items 中可能有同一事件的多源覆盖（不同 cluster_id 但讲同一件事），如果你看到比如 3 条都是 Google 投资 Anthropic 的报道，把它们合并成 summary 里的一条编号项，narrative 里也作为一个事件深聊。你的任务是写 1 篇日报，不是写新闻摘要的列表。${aihotBlock ? "\n\n上方 <aihot-daily> 是 AI HOT 当天精编日报 (https://aihot.virxact.com), 是 must-cover 基线 — 你的 narrative 必须覆盖它的 lead.title 和所有 sections.items。flashes 选择性提及。覆盖时用我们的 voice 重写, 不要照抄他们的措辞。" : ""}`;
}

function normalizeDailyPromptText(text: string): string {
  return text
    .replace(/正文[没未]披露/g, "缺少")
    .replace(/正文没给/g, "缺少")
    .replace(/标题[没未]披露/g, "标题缺少")
    .replace(/上游没说清楚/g, "还缺")
    .replace(/the post does not disclose/gi, "the missing details are");
}

function normalizeDailyOutputText(text: string): string {
  return text
    .replace(/换句话说[，,]*/g, "")
    .replace(/说白了[，,]*/g, "直接看，")
    .replace(/意味着什么/g, "会带来什么")
    .replace(/这意味着/g, "这会让")
    .replace(/本质上/g, "核心是")
    .replace(/不可否认[，,]*/g, "")
    .replace(/综上所述[，,]*/g, "")
    .replace(/总的来说[，,]*/g, "")
    .replace(/不难发现/g, "能看到")
    .replace(/让我们来看看/g, "先看")
    .replace(/接下来让我们/g, "接着看")
    .replace(/在当今/g, "现在")
    .replace(/随着技术/g, "技术继续往前走时")
    .replace(/这给我们的启示/g, "这提醒")
    .replace(/随着AI的/g, "AI继续")
    .replace(/众所周知[，,]*/g, "")
    .replace(/毋庸置疑[，,]*/g, "")
    .replace(/赋能/g, "帮")
    .replace(/助力/g, "帮")
    .replace(/引领/g, "带着")
    .replace(/重塑/g, "改写")
    .replace(/开启新篇章/g, "进入新阶段")
    .replace(/深度加持/g, "加上")
    .replace(/引爆/g, "带火")
    .replace(/近日/g, "这几天")
    .replace(/近期/g, "这段时间")
    .replace(/据了解[，,]*/g, "")
    .replace(/据报道[，,]*/g, "");
}

function splitDenseParagraphs(markdown: string): string {
  return markdown
    .split(/\n{2,}/)
    .map((block) => {
      const trimmed = block.trim();
      if (
        !trimmed ||
        trimmed.startsWith("#") ||
        trimmed.startsWith(">") ||
        /^[-*]\s/.test(trimmed) ||
        /^\d+\.\s/.test(trimmed)
      ) {
        return block;
      }

      const sentences = trimmed.match(/[^。！？.!?]+[。！？.!?]?/g) ?? [trimmed];
      if (sentences.length <= 6) return block;

      const chunks: string[] = [];
      for (let i = 0; i < sentences.length; i += 4) {
        chunks.push(sentences.slice(i, i + 4).join("").trim());
      }
      return chunks.join("\n\n");
    })
    .join("\n\n");
}
