import { z } from "zod";
import {
  publicEventSchema,
  publicItemSchema,
  publicNewsletterSchema,
  publicPolicySchema,
  publicSourceSchema,
} from "./contract-entities";
import { schemaVersionSchema } from "./contract-primitives";

function reportDuplicates(
  values: readonly (number | string)[],
  path: string,
  context: z.core.$RefinementCtx,
): void {
  const seen = new Set<number | string>();
  for (const value of values) {
    if (seen.has(value)) {
      context.addIssue({
        code: "custom",
        path: [path],
        message: `duplicate ${path} ID: ${value}`,
      });
    }
    seen.add(value);
  }
}

export const canonicalStateSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    items: z.array(publicItemSchema),
    events: z.array(publicEventSchema),
    sources: z.array(publicSourceSchema),
    newsletters: z.array(publicNewsletterSchema),
    policies: z.array(publicPolicySchema),
  })
  .superRefine((state, context) => {
    reportDuplicates(state.items.map(({ id }) => id), "items", context);
    reportDuplicates(state.events.map(({ id }) => id), "events", context);
    reportDuplicates(state.sources.map(({ id }) => id), "sources", context);
    reportDuplicates(
      state.newsletters.map(({ id }) => id),
      "newsletters",
      context,
    );
    reportDuplicates(
      state.policies.map(({ version }) => version),
      "policies",
      context,
    );

    const itemsById = new Map(state.items.map((item) => [item.id, item]));
    const eventsById = new Map(state.events.map((event) => [event.id, event]));
    const itemIds = new Set(itemsById.keys());
    const eventIds = new Set(eventsById.keys());
    const sourceIds = new Set(state.sources.map(({ id }) => id));
    for (const [index, item] of state.items.entries()) {
      if (!sourceIds.has(item.sourceId)) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "sourceId"],
          message: "dangling source reference",
        });
      }
      if (item.eventId !== null && !eventIds.has(item.eventId)) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "eventId"],
          message: "dangling event reference",
        });
      }
      if (
        item.eventId !== null &&
        !eventsById.get(item.eventId)?.memberItemIds.includes(item.id)
      ) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "eventId"],
          message: "item event does not contain the item",
        });
      }
    }
    for (const [index, event] of state.events.entries()) {
      for (const itemId of event.memberItemIds) {
        if (!itemIds.has(itemId)) {
          context.addIssue({
            code: "custom",
            path: ["events", index, "memberItemIds"],
            message: "dangling event member reference",
          });
        } else if (itemsById.get(itemId)?.eventId !== event.id) {
          context.addIssue({
            code: "custom",
            path: ["events", index, "memberItemIds"],
            message: "event member points at a different event",
          });
        }
      }
    }
    for (const [index, newsletter] of state.newsletters.entries()) {
      for (const itemId of newsletter.itemIds) {
        if (!itemIds.has(itemId)) {
          context.addIssue({
            code: "custom",
            path: ["newsletters", index, "itemIds"],
            message: "dangling newsletter item reference",
          });
        }
      }
    }
  });

export type CanonicalPublicState = z.infer<typeof canonicalStateSchema>;
