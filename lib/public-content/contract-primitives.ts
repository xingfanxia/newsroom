import { z } from "zod";

export const schemaVersionSchema = z.literal(1);
export const positiveEntityIdSchema = z
  .number()
  .int()
  .safe()
  .positive();
export const nonNegativeSafeIntegerSchema = z
  .number()
  .int()
  .safe()
  .nonnegative();
export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
export const sourceIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]{0,127}$/);
export const publicHttpUrlSchema = z.url({ protocol: /^https?$/ });
export const publicSourceLocatorSchema = z.union([
  publicHttpUrlSchema,
  z.string().regex(/^internal:\/\/[a-z0-9][a-z0-9-]{0,127}$/),
]);

export const utcIsoTimestampSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .refine((value) => {
    const parsed = new Date(value);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
  }, "expected an exact UTC ISO-millisecond timestamp");

export const localizedTextSchema = z.strictObject({
  zh: z.string().nullable(),
  en: z.string().nullable(),
});

export const localizedTitleSchema = z.strictObject({
  raw: z.string().min(1),
  zh: z.string().nullable(),
  en: z.string().nullable(),
});

export const publicHkrSchema = z.strictObject({
  h: z.boolean(),
  k: z.boolean(),
  r: z.boolean(),
});

export const publicTagsSchema = z.strictObject({
  capabilities: z.array(z.string()),
  entities: z.array(z.string()),
  topics: z.array(z.string()),
});
