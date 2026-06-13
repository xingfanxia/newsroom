import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { newsletters } from "@/db/schema";
import { etagSignal } from "@/lib/api/public-helpers";
import {
  invalidQueryError,
  queryParamsRecord,
} from "@/lib/api/query-params";
import { DAILY_NEWSLETTER_KIND, NEWSLETTER_LOCALES } from "@/lib/types";

const dailyColumnLocaleSchema = z.enum(NEWSLETTER_LOCALES).default("zh");
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

const dailyColumnIndexQuerySchema = z.object({
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

async function getLatestDailyColumnRow(locale: DailyColumnLocale) {
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

async function listDailyColumnIndexRows(
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

export type PublicDailyColumnPayload = {
  body: PublicDailyColumn;
  etagSignal: string;
};

export type PublicDailyColumnIndexPayload = {
  body: PublicDailyColumnIndex;
  etagSignal: string;
};

type PublicDailyColumnResult =
  | { ok: true; payload: PublicDailyColumnPayload }
  | { ok: false; error: string; status: 400 | 404 };

type PublicDailyColumnIndexResult =
  | { ok: true; payload: PublicDailyColumnIndexPayload }
  | { ok: false; error: string; status: 400 };

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

export function toPublicDailyColumnPayload(
  row: DailyColumnRow,
): PublicDailyColumnPayload {
  return {
    body: toPublicDailyColumn(row),
    etagSignal: publicDailyColumnEtagSignal(row),
  };
}

export function toPublicDailyColumnIndexPayload(
  rows: DailyColumnIndexRow[],
  query: DailyColumnIndexQuery,
): PublicDailyColumnIndexPayload {
  return {
    body: toPublicDailyColumnIndex(rows),
    etagSignal: publicDailyColumnIndexEtagSignal(rows, query),
  };
}

export async function getLatestPublicDailyColumn(
  rawLocale: string | null,
): Promise<PublicDailyColumnResult> {
  const parsedLocale = dailyColumnLocaleSchema.safeParse(rawLocale ?? "zh");
  if (!parsedLocale.success) {
    return { ok: false, error: "invalid_locale", status: 400 };
  }

  const row = await getLatestDailyColumnRow(parsedLocale.data);
  if (!row) {
    return { ok: false, error: "no_daily_yet", status: 404 };
  }

  return { ok: true, payload: toPublicDailyColumnPayload(row) };
}

export async function getLatestPublicDailyColumnRequestPayload(
  req: Request,
): Promise<PublicDailyColumnResult> {
  const url = new URL(req.url);
  return getLatestPublicDailyColumn(url.searchParams.get("locale"));
}

export async function getPublicDailyColumnByDate({
  rawDate,
  rawLocale,
}: {
  rawDate: string;
  rawLocale: string | null;
}): Promise<PublicDailyColumnResult> {
  const parsedDate = dailyColumnDateSchema.safeParse(rawDate);
  if (!parsedDate.success) {
    return { ok: false, error: "invalid_date", status: 400 };
  }

  const parsedLocale = dailyColumnLocaleSchema.safeParse(rawLocale ?? "zh");
  if (!parsedLocale.success) {
    return { ok: false, error: "invalid_locale", status: 400 };
  }

  const row = await getDailyColumnRowByDate(
    parsedDate.data,
    parsedLocale.data,
  );
  if (!row) {
    return {
      ok: false,
      error: `no_daily_for_${parsedDate.data}`,
      status: 404,
    };
  }

  return { ok: true, payload: toPublicDailyColumnPayload(row) };
}

export async function getPublicDailyColumnByDateRequestPayload(
  req: Request,
  { rawDate }: { rawDate: string },
): Promise<PublicDailyColumnResult> {
  const url = new URL(req.url);
  return getPublicDailyColumnByDate({
    rawDate,
    rawLocale: url.searchParams.get("locale"),
  });
}

export async function getPublicDailyColumnIndex(
  rawQuery: Record<string, string>,
): Promise<PublicDailyColumnIndexResult> {
  const parsed = dailyColumnIndexQuerySchema.safeParse(rawQuery);
  if (!parsed.success) {
    return {
      ok: false,
      error: invalidQueryError(parsed.error.issues),
      status: 400,
    };
  }

  const rows = await listDailyColumnIndexRows(parsed.data);
  return {
    ok: true,
    payload: toPublicDailyColumnIndexPayload(rows, parsed.data),
  };
}

export async function getPublicDailyColumnIndexRequestPayload(
  req: Request,
): Promise<PublicDailyColumnIndexResult> {
  return getPublicDailyColumnIndex(queryParamsRecord(req));
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

export async function getLatestDailyColumnMarkdown(
  locale: DailyColumnLocale,
): Promise<string> {
  const row = await getLatestDailyColumnRow(locale);
  return row ? renderDailyColumnMarkdown(row) : "_今日的日报还没生成_";
}

export async function getDailyColumnMarkdownByDate(
  rawDate: string,
  locale: DailyColumnLocale,
): Promise<string> {
  const parsedDate = dailyColumnDateSchema.safeParse(rawDate);
  if (!parsedDate.success) {
    return "_invalid date format — expected YYYY-MM-DD_";
  }

  const row = await getDailyColumnRowByDate(parsedDate.data, locale);
  return row
    ? renderDailyColumnMarkdown(row)
    : `_no column for ${parsedDate.data}_`;
}
