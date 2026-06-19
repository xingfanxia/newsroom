import { z } from "zod";
import {
  parseQueryParams,
  type QueryParseResult,
} from "@/lib/api/query-params";
import {
  DEFAULT_SAVED_ITEMS_LIMIT,
  DEFAULT_SAVED_ITEMS_LOCALE,
  SAVED_ITEMS_LIMIT_MAX,
  SAVED_ITEMS_LIMIT_MIN,
} from "@/lib/saved/query-defaults";
import { APP_LOCALES } from "@/lib/types";

const savedItemIdSchema = z.number().int().positive();
const savedCollectionIdSchema = z.number().int().positive();

export const v1SavedQuerySchema = z.object({
  collection: z
    .union([z.literal("inbox"), z.coerce.number().int().positive()])
    .optional(),
  limit: z.coerce
    .number()
    .int()
    .min(SAVED_ITEMS_LIMIT_MIN)
    .max(SAVED_ITEMS_LIMIT_MAX)
    .optional()
    .default(DEFAULT_SAVED_ITEMS_LIMIT),
  locale: z.enum(APP_LOCALES).optional().default(DEFAULT_SAVED_ITEMS_LOCALE),
});

export type V1SavedQueryParams = z.infer<typeof v1SavedQuerySchema>;

export function parseV1SavedQueryRequest(
  req: Request,
): QueryParseResult<V1SavedQueryParams> {
  return parseQueryParams(req, v1SavedQuerySchema);
}

export const v1SavedPostBodySchema = z.object({
  item_id: savedItemIdSchema,
  on: z.boolean(),
  collection_id: savedCollectionIdSchema.optional(),
  note: z.string().max(500).optional(),
});

export const feedbackMoveBodySchema = z.object({
  itemId: savedItemIdSchema,
  targetCollectionId: savedCollectionIdSchema.nullable(),
});
