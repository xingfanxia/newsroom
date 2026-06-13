import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { newsletters } from "@/db/schema";
import { etagSignal } from "@/lib/api/public-helpers";
import { DAILY_NEWSLETTER_KIND, NEWSLETTER_LOCALES } from "@/lib/types";

export const dailyColumnLocaleSchema = z.enum(NEWSLETTER_LOCALES).default("zh");
export type DailyColumnLocale = z.infer<typeof dailyColumnLocaleSchema>;

export const dailyColumnDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
  .refine(
    (date) => {
      const parsed = new Date(`${date}T00:00:00Z`);
      return !Number.isNaN(parsed.getTime()) && dailyColumnDateKey(parsed) === date;
    },
    {
      message: "expected valid UTC calendar date",
    },
  );

export const dailyColumnIndexQuerySchema = z.object({
  take: z.coerce.number().int().min(1).max(180).optional().default(30),
  locale: dailyColumnLocaleSchema.optional().default("zh"),
});

export type DailyColumnIndexQuery = z.infer<
  typeof dailyColumnIndexQuerySchema
>;

const fullDailyColumnSelect = {
  id: newsletters.id,
  locale: newsletters.locale,
  columnTitle: newsletters.columnTitle,
  columnThemeTag: newsletters.columnThemeTag,
  columnSummaryMd: newsletters.columnSummaryMd,
  columnNarrativeMd: newsletters.columnNarrativeMd,
  columnFeaturedItemIds: newsletters.columnFeaturedItemIds,
  itemIds: newsletters.itemIds,
  storyCount: newsletters.storyCount,
  periodStart: newsletters.periodStart,
  periodEnd: newsletters.periodEnd,
  publishedAt: newsletters.publishedAt,
  aihotDailyDate: newsletters.aihotDailyDate,
} as const;

const indexDailyColumnSelect = {
  id: newsletters.id,
  columnTitle: newsletters.columnTitle,
  columnThemeTag: newsletters.columnThemeTag,
  storyCount: newsletters.storyCount,
  periodStart: newsletters.periodStart,
  publishedAt: newsletters.publishedAt,
} as const;

function dailyColumnWhere(locale: DailyColumnLocale) {
  return sql`${newsletters.kind} = ${DAILY_NEWSLETTER_KIND}
    AND ${newsletters.locale} = ${locale}
    AND ${newsletters.columnTitle} IS NOT NULL`;
}

export function dailyColumnDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function dailyColumnDayWindow(date: string): {
  start: Date;
  end: Date;
} {
  const start = new Date(`${date}T00:00:00Z`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

export async function getLatestDailyColumnRow(locale: DailyColumnLocale) {
  const [row] = await listDailyColumnRows({ locale, take: 1 });

  return row ?? null;
}

export async function listDailyColumnRows({
  locale,
  take,
  offset = 0,
}: {
  locale: DailyColumnLocale;
  take: number;
  offset?: number;
}) {
  return db()
    .select(fullDailyColumnSelect)
    .from(newsletters)
    .where(dailyColumnWhere(locale))
    .orderBy(sql`${newsletters.periodStart} DESC`)
    .limit(take)
    .offset(offset);
}

export async function getDailyColumnRowByDate(
  date: string,
  locale: DailyColumnLocale,
) {
  const { start, end } = dailyColumnDayWindow(date);
  const [row] = await db()
    .select(fullDailyColumnSelect)
    .from(newsletters)
    .where(
      sql`${dailyColumnWhere(locale)}
        AND ${newsletters.periodStart} >= ${start.toISOString()}::timestamptz
        AND ${newsletters.periodStart} <  ${end.toISOString()}::timestamptz`,
    )
    .limit(1);

  return row ?? null;
}

export async function listDailyColumnIndexRows(
  query: DailyColumnIndexQuery,
) {
  return db()
    .select(indexDailyColumnSelect)
    .from(newsletters)
    .where(dailyColumnWhere(query.locale))
    .orderBy(sql`${newsletters.periodStart} DESC`)
    .limit(query.take);
}

export type DailyColumnRow = NonNullable<
  Awaited<ReturnType<typeof getLatestDailyColumnRow>>
>;
export type DailyColumnIndexRow = Awaited<
  ReturnType<typeof listDailyColumnIndexRows>
>[number];

export type PublicDailyColumn = {
  id: number;
  locale: string;
  date: string;
  generated_at: string;
  window_start: string;
  window_end: string;
  title: string | null;
  theme_tag: string | null;
  summary_md: string | null;
  narrative_md: string | null;
  featured_item_ids: number[];
  item_ids: number[];
  story_count: number;
};

type PublicDailyColumnIndexItem = {
  id: number;
  date: string;
  generated_at: string;
  title: string | null;
  theme_tag: string | null;
  story_count: number;
};

export type PublicDailyColumnIndex = {
  count: number;
  items: PublicDailyColumnIndexItem[];
};

export function toPublicDailyColumn(row: DailyColumnRow): PublicDailyColumn {
  return {
    id: row.id,
    locale: row.locale,
    date: dailyColumnDateKey(row.periodStart),
    generated_at: row.publishedAt.toISOString(),
    window_start: row.periodStart.toISOString(),
    window_end: row.periodEnd.toISOString(),
    title: row.columnTitle,
    theme_tag: row.columnThemeTag,
    summary_md: row.columnSummaryMd,
    narrative_md: row.columnNarrativeMd,
    featured_item_ids: row.columnFeaturedItemIds ?? [],
    item_ids: row.itemIds ?? [],
    story_count: row.storyCount,
  };
}

function toPublicDailyColumnIndexItem(
  row: DailyColumnIndexRow,
): PublicDailyColumnIndexItem {
  return {
    id: row.id,
    date: dailyColumnDateKey(row.periodStart),
    generated_at: row.publishedAt.toISOString(),
    title: row.columnTitle,
    theme_tag: row.columnThemeTag,
    story_count: row.storyCount,
  };
}

export function toPublicDailyColumnIndex(
  rows: DailyColumnIndexRow[],
): PublicDailyColumnIndex {
  return {
    count: rows.length,
    items: rows.map(toPublicDailyColumnIndexItem),
  };
}

export function publicDailyColumnEtagSignal(row: DailyColumnRow): string {
  return etagSignal({
    id: row.id,
    generated: row.publishedAt.toISOString(),
  });
}

export function publicDailyColumnIndexEtagSignal(
  rows: DailyColumnIndexRow[],
  query: DailyColumnIndexQuery,
): string {
  return etagSignal({
    count: rows.length,
    first_id: rows[0]?.id ?? "",
    first_gen: rows[0]?.publishedAt.toISOString() ?? "",
    locale: query.locale,
    take: query.take,
  });
}

export function renderDailyColumnMarkdown(row: {
  columnTitle: string | null;
  columnSummaryMd: string | null;
  columnNarrativeMd: string | null;
  columnThemeTag: string | null;
  periodStart: Date;
}): string {
  const date = dailyColumnDateKey(row.periodStart);
  const tag = row.columnThemeTag ? `\n\n_# ${row.columnThemeTag}_` : "";
  return `# AX 的 AI 日报 · ${date}\n\n## ${row.columnTitle ?? ""}${tag}\n\n${row.columnSummaryMd ?? ""}\n\n---\n\n${row.columnNarrativeMd ?? ""}`;
}
