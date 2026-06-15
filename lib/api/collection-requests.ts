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
  let current: unknown = err;
  for (let depth = 0; depth < 4 && current; depth++) {
    if (/23505|duplicate|unique/i.test(collectionErrorSearchText(current))) {
      return true;
    }
    if (typeof current !== "object") break;

    const cause = (current as { cause?: unknown }).cause;
    if (!cause || cause === current) break;
    current = cause;
  }
  return false;
}

function collectionErrorSearchText(err: unknown): string {
  if (typeof err !== "object" || err === null) return String(err);

  const fields = err as {
    message?: unknown;
    detail?: unknown;
    code?: unknown;
    constraint_name?: unknown;
    constraint?: unknown;
  };
  return [
    err instanceof Error ? err.message : undefined,
    fields.message,
    fields.detail,
    fields.code,
    fields.constraint_name,
    fields.constraint,
  ]
    .filter((value): value is string => typeof value === "string")
    .join("\n");
}
