import { z } from "zod";
import type { Story } from "@/lib/types";

type EventMember = NonNullable<Story["members"]>[number];

const eventMemberClusterIdSchema = z.coerce.number().int().positive();
const eventMemberLocaleSchema = z.enum(["zh", "en"]);

type EventMemberLocale = z.infer<typeof eventMemberLocaleSchema>;

type EventMemberRouteParams =
  | { ok: true; clusterId: number; locale: EventMemberLocale }
  | { ok: false; error: "invalid_id" | "invalid_locale" };

export type EventMemberApiItem = {
  source_id: string;
  source_name: string;
  title: string;
  url: string;
  published_at: string;
  importance: number;
};

export function parseEventMemberRouteParams({
  rawId,
  rawLocale,
  defaultLocale,
}: {
  rawId: string;
  rawLocale: string | null;
  defaultLocale: EventMemberLocale;
}): EventMemberRouteParams {
  const parsedId = eventMemberClusterIdSchema.safeParse(rawId);
  if (!parsedId.success) return { ok: false, error: "invalid_id" };

  const parsedLocale = eventMemberLocaleSchema.safeParse(
    rawLocale ?? defaultLocale,
  );
  if (!parsedLocale.success) {
    return { ok: false, error: "invalid_locale" };
  }

  return {
    ok: true,
    clusterId: parsedId.data,
    locale: parsedLocale.data,
  };
}

export function toEventMemberApiItem(member: EventMember): EventMemberApiItem {
  return {
    source_id: member.sourceId,
    source_name: member.sourceName,
    title: member.title,
    url: member.url,
    published_at: member.publishedAt,
    importance: member.importance,
  };
}

export function toEventMemberApiItems(
  members: EventMember[],
): EventMemberApiItem[] {
  return members.map(toEventMemberApiItem);
}
