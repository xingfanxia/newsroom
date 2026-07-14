import { z } from "zod";
import {
  APP_LOCALES,
  CADENCES,
  NEWSLETTER_KINDS,
  SOURCE_GROUPS,
  SOURCE_HEALTH_STATUSES,
  SOURCE_KINDS,
  SOURCE_LOCALES,
  VISIBLE_ITEM_TIERS,
} from "@/lib/types";
import {
  localizedTextSchema,
  localizedTitleSchema,
  nonNegativeSafeIntegerSchema,
  positiveEntityIdSchema,
  publicHkrSchema,
  publicHttpUrlSchema,
  publicSourceLocatorSchema,
  publicTagsSchema,
  schemaVersionSchema,
  sourceIdSchema,
  utcIsoTimestampSchema,
} from "./contract-primitives";

const visibleTierSchema = z.enum(VISIBLE_ITEM_TIERS);
const nullableTimestampSchema = utcIsoTimestampSchema.nullable();

export const publicItemSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  id: positiveEntityIdSchema,
  sourceId: sourceIdSchema,
  eventId: positiveEntityIdSchema.nullable(),
  title: localizedTitleSchema,
  summary: localizedTextSchema,
  editorNote: localizedTextSchema,
  editorAnalysis: localizedTextSchema,
  bodyMd: z.string().nullable(),
  author: z.string().nullable(),
  url: publicHttpUrlSchema,
  canonicalUrl: publicHttpUrlSchema,
  tags: publicTagsSchema,
  importance: z.number().int().min(0).max(100),
  tier: visibleTierSchema,
  hkr: publicHkrSchema.nullable(),
  publishedAt: utcIsoTimestampSchema,
  createdAt: utcIsoTimestampSchema,
  enrichedAt: utcIsoTimestampSchema,
  commentaryAt: nullableTimestampSchema,
});

export const publicEventSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    id: positiveEntityIdSchema,
    leadItemId: positiveEntityIdSchema,
    memberItemIds: z.array(positiveEntityIdSchema).min(2),
    coverage: positiveEntityIdSchema.min(2),
    firstSeenAt: utcIsoTimestampSchema,
    latestMemberAt: nullableTimestampSchema,
    canonicalTitle: localizedTextSchema,
    editorNote: localizedTextSchema,
    editorAnalysis: localizedTextSchema,
    importance: z.number().int().min(0).max(100),
    tier: visibleTierSchema,
    hkr: publicHkrSchema.nullable(),
  })
  .superRefine((event, context) => {
    const uniqueMembers = new Set(event.memberItemIds);
    if (uniqueMembers.size !== event.memberItemIds.length) {
      context.addIssue({
        code: "custom",
        path: ["memberItemIds"],
        message: "duplicate event member ID",
      });
    }
    if (!uniqueMembers.has(event.leadItemId)) {
      context.addIssue({
        code: "custom",
        path: ["leadItemId"],
        message: "event lead must be a member",
      });
    }
    if (event.coverage !== uniqueMembers.size) {
      context.addIssue({
        code: "custom",
        path: ["coverage"],
        message: "coverage must equal unique member count",
      });
    }
    if (
      event.latestMemberAt !== null &&
      event.latestMemberAt < event.firstSeenAt
    ) {
      context.addIssue({
        code: "custom",
        path: ["latestMemberAt"],
        message: "latest member cannot predate first seen",
      });
    }
  });

const publicSourceHealthSchema = z.strictObject({
  status: z.enum(SOURCE_HEALTH_STATUSES),
  lastSuccessAt: nullableTimestampSchema,
  consecutiveFailures: nonNegativeSafeIntegerSchema,
  totalItemsCount: nonNegativeSafeIntegerSchema,
});

const sourceItemCountsSchema = z.strictObject({
  allTime: nonNegativeSafeIntegerSchema,
  last24h: nonNegativeSafeIntegerSchema,
});

const INTERNAL_SOURCE_LOCATORS: Readonly<Record<string, string>> = {
  "aihot-selected": "internal://aihot-selected",
  "crunchbase-ai": "internal://crunchbase",
};

export const publicSourceSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    id: sourceIdSchema,
    name: z.strictObject({ zh: z.string().min(1), en: z.string().min(1) }),
    url: publicSourceLocatorSchema,
    kind: z.enum(SOURCE_KINDS),
    group: z.enum(SOURCE_GROUPS),
    locale: z.enum(SOURCE_LOCALES),
    cadence: z.enum(CADENCES),
    priority: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    tags: z.array(z.string()),
    enabled: z.boolean(),
    curated: z.boolean(),
    health: publicSourceHealthSchema,
    itemCounts: sourceItemCountsSchema,
  })
  .superRefine((source, context) => {
    if (
      source.url.startsWith("internal://") &&
      INTERNAL_SOURCE_LOCATORS[source.id] !== source.url
    ) {
      context.addIssue({
        code: "custom",
        path: ["url"],
        message: "internal source locator is not allowlisted for this source",
      });
    }
  });

const newsletterBaseShape = {
  schemaVersion: schemaVersionSchema,
  id: positiveEntityIdSchema,
  locale: z.enum(APP_LOCALES),
  periodStart: utcIsoTimestampSchema,
  periodEnd: utcIsoTimestampSchema,
  publishedAt: utcIsoTimestampSchema,
  storyCount: nonNegativeSafeIntegerSchema,
  itemIds: z.array(positiveEntityIdSchema),
} as const;

type NewsletterBase = {
  periodStart: string;
  periodEnd: string;
  itemIds: number[];
};

function validateNewsletterBase(
  newsletter: NewsletterBase,
  context: z.core.$RefinementCtx,
): void {
  if (newsletter.periodEnd <= newsletter.periodStart) {
    context.addIssue({
      code: "custom",
      path: ["periodEnd"],
      message: "newsletter period must end after it starts",
    });
  }
  if (new Set(newsletter.itemIds).size !== newsletter.itemIds.length) {
    context.addIssue({
      code: "custom",
      path: ["itemIds"],
      message: "duplicate newsletter item ID",
    });
  }
}

const dailyColumnNewsletterSchema = z
  .strictObject({
    ...newsletterBaseShape,
    format: z.literal("daily_column"),
    kind: z.literal("daily"),
    title: z.string().nullable(),
    themeTag: z.string().nullable(),
    summaryMd: z.string().nullable(),
    narrativeMd: z.string().nullable(),
    featuredItemIds: z.array(positiveEntityIdSchema),
  })
  .superRefine((newsletter, context) => {
    validateNewsletterBase(newsletter, context);
    const itemIds = new Set(newsletter.itemIds);
    const featuredIds = new Set(newsletter.featuredItemIds);
    if (featuredIds.size !== newsletter.featuredItemIds.length) {
      context.addIssue({
        code: "custom",
        path: ["featuredItemIds"],
        message: "duplicate featured newsletter item ID",
      });
    }
    if (newsletter.featuredItemIds.some((id) => !itemIds.has(id))) {
      context.addIssue({
        code: "custom",
        path: ["featuredItemIds"],
        message: "featured item must be referenced by the newsletter",
      });
    }
  });

const structuredNewsletterSchema = z
  .strictObject({
    ...newsletterBaseShape,
    format: z.literal("structured"),
    kind: z.enum(NEWSLETTER_KINDS),
    headline: z.string().nullable(),
    overview: z.string().nullable(),
    highlights: z.string().nullable(),
    commentary: z.string().nullable(),
  })
  .superRefine(validateNewsletterBase);

export const publicNewsletterSchema = z.discriminatedUnion("format", [
  dailyColumnNewsletterSchema,
  structuredNewsletterSchema,
]);

export const publicPolicySchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  skillName: z.literal("editorial"),
  version: z.string().min(1).max(128),
  committedAt: utcIsoTimestampSchema,
});
