import type { Story } from "@/lib/types";

type EventMember = NonNullable<Story["members"]>[number];

export type EventMemberApiItem = {
  source_id: string;
  source_name: string;
  title: string;
  url: string;
  published_at: string;
  importance: number;
};

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
