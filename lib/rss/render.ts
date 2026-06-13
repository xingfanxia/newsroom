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
  guidIsPermalink?: boolean;
  contentEncoded?: string;
  category?: string;
  source?: string;
  extraElements?: RssExtraElement[];
};

export type RssExtraElement = {
  name: string;
  value: string | number | boolean | null | undefined;
};

export type RssChannel = {
  title: string;
  link: string;
  description: string;
  lastBuildDate: Date;
  items: RssItem[];
  language?: string;
  selfLink?: string;
  generator?: string;
  namespaces?: Record<string, string>;
};

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function assertXmlName(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(name)) {
    throw new Error(`invalid RSS XML element name: ${name}`);
  }
  return name;
}

function rfc822(d: Date): string {
  return d.toUTCString();
}

export function renderMarkdownishHtml(md: string): string {
  const escaped = md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split("\n");
      if (lines.every((line) => line.startsWith("- "))) {
        return `<ul>${lines.map((line) => `<li>${line.slice(2)}</li>`).join("\n")}\n</ul>`;
      }
      const withHeadings = block
        .replace(/^## (.+)$/gm, "<h3>$1</h3>")
        .replace(/^# (.+)$/gm, "<h2>$1</h2>");
      return /^<(h\d|ul|hr|blockquote)/.test(withHeadings)
        ? withHeadings
        : `<p>${withHeadings}</p>`;
    })
    .join("\n");
}

export function renderRssFeed(channel: RssChannel): string {
  const lang = channel.language ?? "zh-CN";
  const selfLink = channel.selfLink ?? channel.link;
  const namespaces = Object.entries(channel.namespaces ?? {})
    .map(([prefix, uri]) => ` xmlns:${assertXmlName(prefix)}="${escapeXml(uri)}"`)
    .join("");
  const generator = channel.generator
    ? `    <generator>${escapeXml(channel.generator)}</generator>\n`
    : "";
  const itemsXml = channel.items
    .map((it) => {
      const cat = it.category
        ? `      <category>${escapeXml(it.category)}</category>\n`
        : "";
      const source = it.source
        ? `      <source>${escapeXml(it.source)}</source>\n`
        : "";
      const extra = (it.extraElements ?? [])
        .filter((element) => element.value !== null && element.value !== undefined)
        .map((element) => {
          const name = assertXmlName(element.name);
          return `      <${name}>${escapeXml(String(element.value))}</${name}>\n`;
        })
        .join("");
      const content = it.contentEncoded
        ? `      <content:encoded><![CDATA[${it.contentEncoded.replace(/]]>/g, "]]]]><![CDATA[>")}]]></content:encoded>\n`
        : "";
      const guidIsPermalink = it.guidIsPermalink ? "true" : "false";
      return `    <item>
      <title>${escapeXml(it.title)}</title>
      <link>${escapeXml(it.link)}</link>
      <description>${escapeXml(it.description)}</description>
      <pubDate>${rfc822(it.pubDate)}</pubDate>
      <guid isPermaLink="${guidIsPermalink}">${escapeXml(it.guid)}</guid>
${source}${cat}${extra}${content}    </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom"${namespaces}>
  <channel>
    <title>${escapeXml(channel.title)}</title>
    <link>${escapeXml(channel.link)}</link>
    <description>${escapeXml(channel.description)}</description>
    <language>${lang}</language>
    <lastBuildDate>${rfc822(channel.lastBuildDate)}</lastBuildDate>
    <atom:link href="${escapeXml(selfLink)}" rel="self" type="application/rss+xml" />
${generator.trimEnd()}
${itemsXml}
  </channel>
</rss>`;
}
