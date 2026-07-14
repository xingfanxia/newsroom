import { getEventMembers } from "@/lib/items/live";
import type { AppLocale } from "@/lib/types";
import {
  parseEventMemberRouteParams,
  toEventMembersPayload,
  type EventMembersPayload,
} from "./event-member-contract";

export {
  eventMembersCacheSignalParts,
  parseEventMemberRouteParams,
  toEventMemberApiItem,
  toEventMemberApiItems,
  toEventMembersListEnvelope,
  toEventMembersPayload,
} from "./event-member-contract";
export type {
  EventMemberApiItem,
  EventMembersListEnvelope,
  EventMembersPayload,
  EventMemberRouteParams,
} from "./event-member-contract";

type EventMembersRoutePayloadResult =
  | { ok: true; payload: EventMembersPayload }
  | { ok: false; error: "invalid_id" | "invalid_locale"; status: 400 };

export async function getEventMembersPayload(
  clusterId: number,
  locale: AppLocale,
): Promise<EventMembersPayload> {
  const members = await getEventMembers(clusterId, locale);
  return toEventMembersPayload(clusterId, members);
}

export async function getEventMembersRoutePayload({
  rawId,
  rawLocale,
  defaultLocale,
}: {
  rawId: string;
  rawLocale: string | null;
  defaultLocale: AppLocale;
}): Promise<EventMembersRoutePayloadResult> {
  const parsed = parseEventMemberRouteParams({
    rawId,
    rawLocale,
    defaultLocale,
  });
  if (!parsed.ok) {
    return { ok: false, error: parsed.error, status: 400 };
  }

  return {
    ok: true,
    payload: await getEventMembersPayload(parsed.clusterId, parsed.locale),
  };
}

export async function getEventMembersRequestPayload(
  req: Request,
  {
    rawId,
    defaultLocale,
  }: {
    rawId: string;
    defaultLocale: AppLocale;
  },
): Promise<EventMembersRoutePayloadResult> {
  const url = new URL(req.url);
  return getEventMembersRoutePayload({
    rawId,
    rawLocale: url.searchParams.get("locale"),
    defaultLocale,
  });
}
