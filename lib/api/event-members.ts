import { z } from "zod";
import {
  INVALID_ROUTE_ID_ERROR,
  parsePositiveRouteId,
} from "@/lib/api/route-params";
import { APP_LOCALES, type Story } from "@/lib/types";

type EventMember = NonNullable<Story["members"]>[number];

const eventMemberLocaleSchema = z.enum(APP_LOCALES);

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
  const parsedId = parsePositiveRouteId(rawId);
  if (!parsedId.ok) return { ok: false, error: INVALID_ROUTE_ID_ERROR };

  const parsedLocale = eventMemberLocaleSchema.safeParse(
    rawLocale ?? defaultLocale,
  );
  if (!parsedLocale.success) {
    return { ok: false, error: "invalid_locale" };
  }

  return {
    ok: true,
    clusterId: parsedId.id,
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
