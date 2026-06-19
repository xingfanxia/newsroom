import { z } from "zod";
import { parseQueryParams } from "@/lib/api/query-params";
import {
  DEFAULT_API_FEED_LOCALE,
  DEFAULT_FEED_HOT_WINDOW_HOURS,
  DEFAULT_FEED_LIMIT,
  DEFAULT_FEED_OFFSET,
  DEFAULT_FEED_TIER,
  DEFAULT_FEED_VIEW,
  FEED_HOT_WINDOW_HOURS_MAX,
  FEED_HOT_WINDOW_HOURS_MIN,
  FEED_LIMIT_MIN,
  MCP_FEED_LIMIT_MAX,
  PUBLIC_FEED_LIMIT_MAX,
  V1_FEED_LIMIT_MAX,
} from "@/lib/feed/query-defaults";
import {
  DEFAULT_API_SEARCH_LOCALE,
  DEFAULT_SEARCH_LIMIT,
  DEFAULT_SEARCH_MODE,
  DEFAULT_SEARCH_OFFSET,
  DEFAULT_SEARCH_SEMANTIC_INCLUDE_EXCLUDED,
  DEFAULT_SEARCH_TIER,
  MCP_SEARCH_LIMIT_MAX,
  PUBLIC_SEARCH_LIMIT_MAX,
  SEARCH_LIMIT_MIN,
  V1_SEARCH_LIMIT_MAX,
} from "@/lib/search/query-defaults";
import type { FeedQuery } from "@/lib/items/live";
import {
  APP_LOCALES,
  FEED_VIEWS,
  SEARCH_MODES,
  SOURCE_GROUPS,
  SOURCE_KINDS,
  VISIBLE_ITEM_TIERS,
} from "@/lib/types";
import type { SearchMode } from "@/lib/types";

const ymdSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
  .optional();

const boolParamSchema = z
  .enum(["true", "false", "1", "0"])
  .optional()
  .transform((v) => v === "true" || v === "1");

function limitParamSchema(
  min: number,
  max: number,
  defaultValue: number,
) {
  return z.coerce
    .number()
    .int()
    .min(min)
    .max(max)
    .optional()
    .default(defaultValue);
}

function makeFeedQueryParamSchema(options: {
  maxLimit: number;
  defaultLimit: number;
}) {
  return z.object({
    tier: z.enum(VISIBLE_ITEM_TIERS).optional().default(DEFAULT_FEED_TIER),
    view: z.enum(FEED_VIEWS).optional().default(DEFAULT_FEED_VIEW),
    hot_window_hours: z.coerce
      .number()
      .int()
      .min(FEED_HOT_WINDOW_HOURS_MIN)
      .max(FEED_HOT_WINDOW_HOURS_MAX)
      .optional()
      .default(DEFAULT_FEED_HOT_WINDOW_HOURS),
    date: ymdSchema,
    date_from: z.string().datetime().optional(),
    date_to: z.string().datetime().optional(),
    source_id: z.string().min(1).optional(),
    source_group: z.enum(SOURCE_GROUPS).optional(),
    source_kind: z.enum(SOURCE_KINDS).optional(),
    curated_only: boolParamSchema,
    exclude_source_tags: z.string().min(1).optional(),
    include_source_tags: z.string().min(1).optional(),
    limit: limitParamSchema(
      FEED_LIMIT_MIN,
      options.maxLimit,
      options.defaultLimit,
    ),
    offset: z.coerce
      .number()
      .int()
      .min(0)
      .optional()
      .default(DEFAULT_FEED_OFFSET),
    locale: z.enum(APP_LOCALES).optional().default(DEFAULT_API_FEED_LOCALE),
  });
}

function makeSearchQueryParamSchema(options: {
  maxLimit: number;
  defaultLimit: number;
}) {
  return z.object({
    q: z.string().min(1, "q is required"),
    mode: z.enum(SEARCH_MODES).optional().default(DEFAULT_SEARCH_MODE),
    tier: z.enum(VISIBLE_ITEM_TIERS).optional().default(DEFAULT_SEARCH_TIER),
    date: ymdSchema,
    date_from: z.string().datetime().optional(),
    date_to: z.string().datetime().optional(),
    source_id: z.string().min(1).optional(),
    source_group: z.enum(SOURCE_GROUPS).optional(),
    source_kind: z.enum(SOURCE_KINDS).optional(),
    limit: limitParamSchema(
      SEARCH_LIMIT_MIN,
      options.maxLimit,
      options.defaultLimit,
    ),
    offset: z.coerce
      .number()
      .int()
      .min(0)
      .optional()
      .default(DEFAULT_SEARCH_OFFSET),
    locale: z.enum(APP_LOCALES).optional().default(DEFAULT_API_SEARCH_LOCALE),
  });
}

export const v1FeedQueryParamSchema = makeFeedQueryParamSchema({
  maxLimit: V1_FEED_LIMIT_MAX,
  defaultLimit: DEFAULT_FEED_LIMIT,
});

export const publicFeedQueryParamSchema = makeFeedQueryParamSchema({
  maxLimit: PUBLIC_FEED_LIMIT_MAX,
  defaultLimit: DEFAULT_FEED_LIMIT,
});

export const v1SearchQueryParamSchema = makeSearchQueryParamSchema({
  maxLimit: V1_SEARCH_LIMIT_MAX,
  defaultLimit: DEFAULT_SEARCH_LIMIT,
});

export const publicSearchQueryParamSchema = makeSearchQueryParamSchema({
  maxLimit: PUBLIC_SEARCH_LIMIT_MAX,
  defaultLimit: DEFAULT_SEARCH_LIMIT,
});

export const mcpFeedToolInputShape = {
  tier: z.enum(VISIBLE_ITEM_TIERS).optional(),
  view: z.enum(FEED_VIEWS).optional(),
  hot_window_hours: z
    .number()
    .int()
    .min(FEED_HOT_WINDOW_HOURS_MIN)
    .max(FEED_HOT_WINDOW_HOURS_MAX)
    .optional(),
  source_id: z.string().optional(),
  source_group: z.enum(SOURCE_GROUPS).optional(),
  source_kind: z.enum(SOURCE_KINDS).optional(),
  curated_only: z.boolean().optional(),
  exclude_source_tags: z.array(z.string()).optional(),
  include_source_tags: z.array(z.string()).optional(),
  date: z.string().optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  limit: z
    .number()
    .int()
    .min(FEED_LIMIT_MIN)
    .max(MCP_FEED_LIMIT_MAX)
    .optional(),
  offset: z.number().int().min(0).optional(),
  locale: z.enum(APP_LOCALES).optional(),
} as const;

export const mcpSearchToolInputShape = {
  q: z.string().min(1),
  mode: z.enum(SEARCH_MODES).optional(),
  source_id: z.string().optional(),
  source_group: z.enum(SOURCE_GROUPS).optional(),
  source_kind: z.enum(SOURCE_KINDS).optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  limit: z
    .number()
    .int()
    .min(SEARCH_LIMIT_MIN)
    .max(MCP_SEARCH_LIMIT_MAX)
    .optional(),
  locale: z.enum(APP_LOCALES).optional(),
} as const;

export const mcpFeedToolInputSchema = z.object(mcpFeedToolInputShape);
export const mcpSearchToolInputSchema = z.object(mcpSearchToolInputShape);

export type FeedQueryParams =
  | z.infer<typeof v1FeedQueryParamSchema>
  | z.infer<typeof publicFeedQueryParamSchema>;

export type SearchQueryParams =
  | z.infer<typeof v1SearchQueryParamSchema>
  | z.infer<typeof publicSearchQueryParamSchema>;

export type McpFeedToolInput = z.infer<typeof mcpFeedToolInputSchema>;
export type McpSearchToolInput = z.infer<typeof mcpSearchToolInputSchema>;
export type McpSearchExecutionParams = SearchQueryParams & {
  mode: SearchMode;
  semanticIncludeExcluded: boolean;
};

type V1FeedQueryParams = z.infer<typeof v1FeedQueryParamSchema>;
type PublicFeedQueryParams = z.infer<typeof publicFeedQueryParamSchema>;
type V1SearchQueryParams = z.infer<typeof v1SearchQueryParamSchema>;
type PublicSearchQueryParams = z.infer<typeof publicSearchQueryParamSchema>;

type QueryRequestParseResult<T> =
  | { ok: true; data: T; search: string }
  | { ok: false; issues: unknown[] };

type RequestQuerySchema<T> = {
  safeParse(
    input: Record<string, string>,
  ):
    | { success: true; data: T }
    | { success: false; error: { issues: unknown[] } };
};

export function parseCommaList(s: string | undefined): string[] | undefined {
  if (!s) return undefined;
  const values = s
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  return values.length > 0 ? values : undefined;
}

function parseFeedRequestQuery<T>(
  req: Request,
  schema: RequestQuerySchema<T>,
): QueryRequestParseResult<T> {
  const url = new URL(req.url);
  const parsed = parseQueryParams(url, schema);
  if (!parsed.ok) return parsed;
  return { ok: true, data: parsed.data, search: url.search };
}

export function parseV1FeedQueryRequest(
  req: Request,
): QueryRequestParseResult<V1FeedQueryParams> {
  return parseFeedRequestQuery(req, v1FeedQueryParamSchema);
}

export function parsePublicFeedQueryRequest(
  req: Request,
): QueryRequestParseResult<PublicFeedQueryParams> {
  return parseFeedRequestQuery(req, publicFeedQueryParamSchema);
}

export function parseV1SearchQueryRequest(
  req: Request,
): QueryRequestParseResult<V1SearchQueryParams> {
  return parseFeedRequestQuery(req, v1SearchQueryParamSchema);
}

export function parsePublicSearchQueryRequest(
  req: Request,
): QueryRequestParseResult<PublicSearchQueryParams> {
  return parseFeedRequestQuery(req, publicSearchQueryParamSchema);
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

export function feedQueryFromMcpToolArgs(args: McpFeedToolInput): FeedQuery {
  return {
    tier: args.tier ?? DEFAULT_FEED_TIER,
    locale: args.locale ?? DEFAULT_API_FEED_LOCALE,
    limit: args.limit ?? DEFAULT_FEED_LIMIT,
    offset: args.offset ?? DEFAULT_FEED_OFFSET,
    sourceId: args.source_id,
    sourceGroup: args.source_group,
    sourceKind: args.source_kind,
    date: args.date,
    dateFrom: args.date_from,
    dateTo: args.date_to,
    includeSourceGroup: true,
    view: args.view ?? DEFAULT_FEED_VIEW,
    hotWindowHours: args.hot_window_hours ?? DEFAULT_FEED_HOT_WINDOW_HOURS,
    curatedOnly: args.curated_only || undefined,
    excludeSourceTags: args.exclude_source_tags,
    includeSourceTags: args.include_source_tags,
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

export function searchQueryFromMcpToolArgs(
  args: McpSearchToolInput,
): McpSearchExecutionParams {
  return {
    q: args.q,
    mode: args.mode ?? DEFAULT_SEARCH_MODE,
    tier: DEFAULT_SEARCH_TIER,
    locale: args.locale ?? DEFAULT_API_SEARCH_LOCALE,
    limit: args.limit ?? DEFAULT_SEARCH_LIMIT,
    offset: DEFAULT_SEARCH_OFFSET,
    source_id: args.source_id,
    source_group: args.source_group,
    source_kind: args.source_kind,
    date_from: args.date_from,
    date_to: args.date_to,
    semanticIncludeExcluded: DEFAULT_SEARCH_SEMANTIC_INCLUDE_EXCLUDED,
  };
}
