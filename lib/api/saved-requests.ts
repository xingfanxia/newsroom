import { z } from "zod";
import { APP_LOCALES } from "@/lib/types";

const savedItemIdSchema = z.number().int().positive();
const savedCollectionIdSchema = z.number().int().positive();

export const v1SavedQuerySchema = z.object({
  collection: z
    .union([z.literal("inbox"), z.coerce.number().int().positive()])
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(80),
  locale: z.enum(APP_LOCALES).optional().default("en"),
});

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
