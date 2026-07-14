import { canonicalStateSchema } from "@/lib/public-content/contracts";
import type { AppLocale } from "@/lib/types";

export type PublicDailyColumn = {
  id: number;
  locale: AppLocale;
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

export type PublicDailyColumnIndex = {
  count: number;
  items: Array<{
    id: number;
    date: string;
    generated_at: string;
    title: string | null;
    theme_tag: string | null;
    story_count: number;
  }>;
};

export function listPublicDailyIndex(
  value: unknown,
  options: { locale?: AppLocale; take?: number } = {},
): PublicDailyColumnIndex {
  const locale = options.locale ?? "zh";
  const take = options.take ?? 20;
  if (!Number.isSafeInteger(take) || take < 0) {
    throw new TypeError("take must be a non-negative safe integer");
  }
  const rows = dailyRows(value, locale).slice(0, take);
  return {
    count: rows.length,
    items: rows.map((row) => ({
      id: row.id,
      date: row.periodStart.slice(0, 10),
      generated_at: row.publishedAt,
      title: row.title,
      theme_tag: row.themeTag,
      story_count: row.storyCount,
    })),
  };
}

export function getPublicDailyByDate(
  value: unknown,
  date: string,
  locale: AppLocale = "zh",
): PublicDailyColumn | null {
  assertDate(date);
  const row = dailyRows(value, locale).find(
    (candidate) => candidate.periodStart.slice(0, 10) === date,
  );
  return row ? toPublicDaily(row) : null;
}

export function getLatestPublicDaily(
  value: unknown,
  locale: AppLocale = "zh",
): PublicDailyColumn | null {
  const row = dailyRows(value, locale)[0];
  return row ? toPublicDaily(row) : null;
}

export function renderPublicDailyMarkdown(daily: PublicDailyColumn): string {
  const title = daily.title ? `\n\n## ${daily.title}` : "";
  const theme = daily.theme_tag ? `\n\n_# ${daily.theme_tag}_` : "";
  const summary = daily.summary_md ? `\n\n${daily.summary_md}` : "";
  const narrative = daily.narrative_md ? `\n\n---\n\n${daily.narrative_md}` : "";
  return `# AX 的 AI 日报 · ${daily.date}${title}${theme}${summary}${narrative}`;
}

type DailyRow = Extract<
  ReturnType<typeof canonicalStateSchema.parse>["newsletters"][number],
  { format: "daily_column" }
>;

function dailyRows(value: unknown, locale: AppLocale): DailyRow[] {
  return canonicalStateSchema
    .parse(value)
    .newsletters.filter(
      (row): row is DailyRow => row.format === "daily_column" && row.locale === locale,
    )
    .sort((left, right) => right.periodStart.localeCompare(left.periodStart));
}

function toPublicDaily(row: DailyRow): PublicDailyColumn {
  return {
    id: row.id,
    locale: row.locale,
    date: row.periodStart.slice(0, 10),
    generated_at: row.publishedAt,
    window_start: row.periodStart,
    window_end: row.periodEnd,
    title: row.title,
    theme_tag: row.themeTag,
    summary_md: row.summaryMd,
    narrative_md: row.narrativeMd,
    featured_item_ids: [...row.featuredItemIds],
    item_ids: [...row.itemIds],
    story_count: row.storyCount,
  };
}

function assertDate(value: string): void {
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString().slice(0, 10) !== value
  ) {
    throw new TypeError(`invalid date: ${value}`);
  }
}
