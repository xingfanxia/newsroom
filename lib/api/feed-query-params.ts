import { z } from "zod";
import type { FeedQuery } from "@/lib/items/live";
import {
  APP_LOCALES,
  FEED_VIEWS,
  SEARCH_MODES,
  SOURCE_GROUPS,
  SOURCE_KINDS,
  VISIBLE_ITEM_TIERS,
} from "@/lib/types";

const ymdSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
  .optional();

const boolParamSchema = z
  .enum(["true", "false", "1", "0"])
  .optional()
  .transform((v) => v === "true" || v === "1");

function limitParamSchema(max: number, defaultValue: number) {
  return z.coerce.number().int().min(1).max(max).optional().default(defaultValue);
}

function makeFeedQueryParamSchema(options: {
  maxLimit: number;
  defaultLimit: number;
}) {
  return z.object({
    tier: z.enum(VISIBLE_ITEM_TIERS).optional().default("featured"),
    view: z.enum(FEED_VIEWS).optional().default("archive"),
    hot_window_hours: z.coerce
      .number()
      .int()
      .min(1)
      .max(168)
      .optional()
      .default(24),
    date: ymdSchema,
    date_from: z.string().datetime().optional(),
    date_to: z.string().datetime().optional(),
    source_id: z.string().min(1).optional(),
    source_group: z.enum(SOURCE_GROUPS).optional(),
    source_kind: z.enum(SOURCE_KINDS).optional(),
    curated_only: boolParamSchema,
    exclude_source_tags: z.string().min(1).optional(),
    include_source_tags: z.string().min(1).optional(),
    limit: limitParamSchema(options.maxLimit, options.defaultLimit),
    offset: z.coerce.number().int().min(0).optional().default(0),
    locale: z.enum(APP_LOCALES).optional().default("en"),
  });
}

function makeSearchQueryParamSchema(options: {
  maxLimit: number;
  defaultLimit: number;
}) {
  return z.object({
    q: z.string().min(1, "q is required"),
    mode: z.enum(SEARCH_MODES).optional().default("lexical"),
    tier: z.enum(VISIBLE_ITEM_TIERS).optional().default("all"),
    date: ymdSchema,
    date_from: z.string().datetime().optional(),
    date_to: z.string().datetime().optional(),
    source_id: z.string().min(1).optional(),
    source_group: z.enum(SOURCE_GROUPS).optional(),
    source_kind: z.enum(SOURCE_KINDS).optional(),
    limit: limitParamSchema(options.maxLimit, options.defaultLimit),
    offset: z.coerce.number().int().min(0).optional().default(0),
    locale: z.enum(APP_LOCALES).optional().default("en"),
  });
}

export const v1FeedQueryParamSchema = makeFeedQueryParamSchema({
  maxLimit: 500,
  defaultLimit: 40,
});

export const publicFeedQueryParamSchema = makeFeedQueryParamSchema({
  maxLimit: 100,
  defaultLimit: 40,
});

export const v1SearchQueryParamSchema = makeSearchQueryParamSchema({
  maxLimit: 100,
  defaultLimit: 20,
});

export const publicSearchQueryParamSchema = makeSearchQueryParamSchema({
  maxLimit: 50,
  defaultLimit: 20,
});

export type FeedQueryParams =
  | z.infer<typeof v1FeedQueryParamSchema>
  | z.infer<typeof publicFeedQueryParamSchema>;

export type SearchQueryParams =
  | z.infer<typeof v1SearchQueryParamSchema>
  | z.infer<typeof publicSearchQueryParamSchema>;

export function parseCommaList(s: string | undefined): string[] | undefined {
  if (!s) return undefined;
  const values = s
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  return values.length > 0 ? values : undefined;
}

export function feedQueryFromParams(q: FeedQueryParams): FeedQuery {
  return {
    tier: q.tier,
    locale: q.locale,
    limit: q.limit,
    offset: q.offset,
    sourceId: q.source_id,
    sourceGroup: q.source_group,
    sourceKind: q.source_kind,
    date: q.date,
    dateFrom: q.date_from,
    dateTo: q.date_to,
    includeSourceGroup: true,
    view: q.view,
    hotWindowHours: q.hot_window_hours,
    curatedOnly: q.curated_only || undefined,
    excludeSourceTags: parseCommaList(q.exclude_source_tags),
    includeSourceTags: parseCommaList(q.include_source_tags),
  };
}

export function searchFeedQueryFromParams(q: SearchQueryParams): FeedQuery {
  return {
    tier: q.tier,
    locale: q.locale,
    limit: q.limit,
    offset: q.offset,
    sourceId: q.source_id,
    sourceGroup: q.source_group,
    sourceKind: q.source_kind,
    date: q.date,
    dateFrom: q.date_from,
    dateTo: q.date_to,
    includeSourceGroup: true,
    searchText: q.q,
  };
}
