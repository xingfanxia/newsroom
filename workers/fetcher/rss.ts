import { XMLParser } from "fast-xml-parser";

export type FeedItem = {
  externalId: string;
  url: string;
  title: string;
  publishedAt: Date | null;
  rawPayload: unknown;
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseAttributeValue: false,
  trimValues: true,
});

/**
 * Parse an RSS 2.0 or Atom 1.0 feed into a flat list of FeedItems.
 * Defensive: tolerates missing fields, single-item vs array nodes, CDATA text nodes.
 */
export function parseFeed(xml: string): FeedItem[] {
  const parsed = parser.parse(xml);

  // RSS 2.0
  if (parsed?.rss?.channel) {
    const channel = parsed.rss.channel;
    const items = normalizeArray(channel.item);
    return items.map(rssItemToFeedItem).filter(Boolean) as FeedItem[];
  }

  // Atom 1.0
  if (parsed?.feed?.entry) {
    const entries = normalizeArray(parsed.feed.entry);
    return entries.map(atomEntryToFeedItem).filter(Boolean) as FeedItem[];
  }

  // Atom feed with no entries
  if (parsed?.feed) return [];

  throw new Error("unrecognized feed format (not RSS 2.0 or Atom 1.0)");
}

function normalizeArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function textValue(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (v && typeof v === "object") {
    const obj = v as Record<string, unknown>;
    if (typeof obj["#text"] === "string") return (obj["#text"] as string).trim();
  }
  return "";
}

function parseDate(v: unknown): Date | null {
  const s = textValue(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function rssItemToFeedItem(item: Record<string, unknown>): FeedItem | null {
  const link = textValue(item.link);
  const guid = textValue(item.guid) || link;
  if (!link && !guid) return null;

  const title = textValue(item.title) || "(untitled)";
  const publishedAt =
    parseDate(item.pubDate) ||
    parseDate((item as { "dc:date"?: unknown })["dc:date"]);

  return {
    externalId: guid,
    url: link || guid,
    title,
    publishedAt,
    rawPayload: item,
  };
}

function atomEntryToFeedItem(entry: Record<string, unknown>): FeedItem | null {
  const id = textValue(entry.id);
  const links = normalizeArray(entry.link as unknown);
  const primaryLink = links.find((l) => {
    if (typeof l === "object" && l !== null) {
      const obj = l as Record<string, unknown>;
      return !obj["@_rel"] || obj["@_rel"] === "alternate";
    }
    return true;
  });

  let url = "";
  if (typeof primaryLink === "string") url = primaryLink;
  else if (primaryLink && typeof primaryLink === "object") {
    const obj = primaryLink as Record<string, unknown>;
    url = typeof obj["@_href"] === "string" ? obj["@_href"] : "";
  }

  if (!id && !url) return null;

  const title = textValue(entry.title) || "(untitled)";
  const publishedAt = parseDate(entry.published) || parseDate(entry.updated);

  return {
    externalId: id || url,
    url: url || id,
    title,
    publishedAt,
    rawPayload: entry,
  };
}
