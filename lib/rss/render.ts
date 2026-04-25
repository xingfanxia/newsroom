/**
 * RSS 2.0 envelope renderer with content:encoded support.
 * Pure function, no IO. Caller wraps in a NextResponse with the right
 * Content-Type + cache headers.
 */

export type RssItem = {
  title: string;
  link: string;
  description: string;
  pubDate: Date;
  guid: string;
  contentEncoded?: string;
  category?: string;
};

export type RssChannel = {
  title: string;
  link: string;
  description: string;
  lastBuildDate: Date;
  items: RssItem[];
  language?: string;
  selfLink?: string;
};

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function rfc822(d: Date): string {
  return d.toUTCString();
}

export function renderRssFeed(channel: RssChannel): string {
  const lang = channel.language ?? "zh-CN";
  const selfLink = channel.selfLink ?? channel.link;
  const itemsXml = channel.items
    .map((it) => {
      const cat = it.category
        ? `      <category>${escapeXml(it.category)}</category>\n`
        : "";
      const content = it.contentEncoded
        ? `      <content:encoded><![CDATA[${it.contentEncoded.replace(/]]>/g, "]]]]><![CDATA[>")}]]></content:encoded>\n`
        : "";
      return `    <item>
      <title>${escapeXml(it.title)}</title>
      <link>${escapeXml(it.link)}</link>
      <description>${escapeXml(it.description)}</description>
      <pubDate>${rfc822(it.pubDate)}</pubDate>
      <guid isPermaLink="false">${escapeXml(it.guid)}</guid>
${cat}${content}    </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(channel.title)}</title>
    <link>${escapeXml(channel.link)}</link>
    <description>${escapeXml(channel.description)}</description>
    <language>${lang}</language>
    <lastBuildDate>${rfc822(channel.lastBuildDate)}</lastBuildDate>
    <atom:link href="${escapeXml(selfLink)}" rel="self" type="application/rss+xml" />
${itemsXml}
  </channel>
</rss>`;
}
