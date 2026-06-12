import { z } from "zod";

const collectionNameSchema = z.string().min(1).max(64);
const collectionNameCjkSchema = z.string().max(64).optional().nullable();
const collectionPinnedSchema = z.boolean().optional();
const collectionIdSchema = z.number().int().positive();

type CollectionCreateBody = {
  name: string;
  nameCjk: string | null;
  pinned: boolean;
};

type CollectionUpdateBody = {
  id: number;
  name?: string;
  nameCjk?: string;
  pinned?: boolean;
};

export const adminCollectionCreateBodySchema = z
  .object({
    name: collectionNameSchema,
    nameCjk: collectionNameCjkSchema,
    pinned: collectionPinnedSchema,
  })
  .transform(
    (body): CollectionCreateBody => ({
      name: body.name,
      nameCjk: body.nameCjk ?? null,
      pinned: body.pinned ?? false,
    }),
  );

export const adminCollectionUpdateBodySchema = z
  .object({
    id: collectionIdSchema,
    name: collectionNameSchema.optional(),
    nameCjk: collectionNameCjkSchema,
    pinned: collectionPinnedSchema,
  })
  .transform(
    (body): CollectionUpdateBody => ({
      id: body.id,
      name: body.name,
      nameCjk: body.nameCjk ?? undefined,
      pinned: body.pinned,
    }),
  );

export const v1CollectionCreateBodySchema = z
  .object({
    name: collectionNameSchema,
    name_cjk: collectionNameCjkSchema,
    pinned: collectionPinnedSchema,
  })
  .transform(
    (body): CollectionCreateBody => ({
      name: body.name,
      nameCjk: body.name_cjk ?? null,
      pinned: body.pinned ?? false,
    }),
  );

export const v1CollectionUpdateBodySchema = z
  .object({
    id: collectionIdSchema,
    name: collectionNameSchema.optional(),
    name_cjk: collectionNameCjkSchema,
    pinned: collectionPinnedSchema,
  })
  .transform(
    (body): CollectionUpdateBody => ({
      id: body.id,
      name: body.name,
      nameCjk: body.name_cjk ?? undefined,
      pinned: body.pinned,
    }),
  );

export const collectionDeleteBodySchema = z.object({ id: collectionIdSchema });

export function isDuplicateCollectionNameError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /duplicate|unique/i.test(message);
}
