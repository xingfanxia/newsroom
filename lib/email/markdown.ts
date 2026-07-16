import { escapeEmailHtml, isSafeHref } from "@/lib/email/escape";
import { EMAIL_STYLE } from "@/lib/email/templates/styles";

/**
 * Constrained markdown → email-HTML renderer for the daily-column contract
 * (lib/llm/prompts/daily-column.md): ##/### sections, **bold**, > quotes,
 * -/1. lists (小信号), [#NNNN] item refs, [text](url) links, paragraphs.
 * Escape-first: content is LLM/feed-derived = untrusted (PLAN.md §5).
 * [#NNNN] resolves to the item's EXTERNAL url — /zh/items/<id> does not
 * exist as a page route; unresolvable refs degrade to plain text.
 */
export type EmailMarkdownOptions = {
  itemUrlById?: Map<number, string>;
};

/**
 * Inline pass over already-escaped text. Inserted anchor markup is
 * stashed behind NUL sentinels so later passes (links, bold, em) can
 * never match across it — that cross-markup interaction produced
 * nested/broken anchors on adversarial input (NLE-2 review M2).
 */
function renderInline(escaped: string, opts: EmailMarkdownOptions): string {
  const stash: string[] = [];
  const put = (html: string): string => {
    stash.push(html);
    return `\u0000${stash.length - 1}\u0000`;
  };

  let out = escaped.replace(/\[#(\d+)\]/g, (_, id: string) => {
    const url = opts.itemUrlById?.get(Number(id));
    if (!url || !isSafeHref(url)) return `#${id}`;
    return put(
      `<a href="${escapeEmailHtml(url)}" style="${EMAIL_STYLE.link}">#${id}</a>`,
    );
  });
  out = out.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_, label: string, href: string) => {
      // A sentinel inside label/href means the region already holds
      // inserted markup — degrade to the plain label, never nest.
      if (
        !isSafeHref(href) ||
        label.includes("\u0000") ||
        href.includes("\u0000")
      ) {
        return label;
      }
      return put(`<a href="${href}" style="${EMAIL_STYLE.link}">${label}</a>`);
    },
  );
  out = out.replace(
    /\*\*([^*]+)\*\*/g,
    (_, inner: string) => put(`<strong style="${EMAIL_STYLE.strong}">${inner}</strong>`),
  );
  out = out.replace(/\*([^*]+)\*/g, (_, inner: string) =>
    put(`<em style="${EMAIL_STYLE.em}">${inner}</em>`),
  );

  // Restore stashed markup; repeat because stashed HTML (e.g. bold whose
  // inner text held a ref sentinel) can itself contain sentinels.
  for (let i = 0; i <= stash.length && out.includes("\u0000"); i++) {
    out = out.replace(/\u0000(\d+)\u0000/g, (_, index: string) => {
      return stash[Number(index)] ?? "";
    });
  }
  return out;
}

type Block =
  | { type: "heading"; level: 2 | 3; text: string }
  | { type: "quote"; lines: string[] }
  | { type: "ul" | "ol"; items: string[] }
  | { type: "paragraph"; lines: string[] };

function parseBlocks(md: string): Block[] {
  const blocks: Block[] = [];
  const lines = md.replaceAll("\r\n", "\n").split("\n");
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (trimmed === "") {
      index++;
      continue;
    }
    const heading = /^(#{2,3})\s+(.*)$/.exec(trimmed);
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[1] === "###" ? 3 : 2,
        text: heading[2] ?? "",
      });
      index++;
      continue;
    }
    if (trimmed.startsWith(">")) {
      const quoteLines: string[] = [];
      while (index < lines.length) {
        const current = (lines[index] ?? "").trim();
        if (!current.startsWith(">")) break;
        quoteLines.push(current.replace(/^>\s?/, ""));
        index++;
      }
      blocks.push({ type: "quote", lines: quoteLines });
      continue;
    }
    const bullet = /^[-*]\s+/.test(trimmed);
    const numbered = /^\d+\.\s+/.test(trimmed);
    if (bullet || numbered) {
      const marker = bullet ? /^[-*]\s+/ : /^\d+\.\s+/;
      const items: string[] = [];
      while (index < lines.length) {
        const current = (lines[index] ?? "").trim();
        if (!marker.test(current)) break;
        items.push(current.replace(marker, ""));
        index++;
      }
      blocks.push({ type: bullet ? "ul" : "ol", items });
      continue;
    }
    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const current = (lines[index] ?? "").trim();
      if (
        current === "" ||
        /^#{2,3}\s+/.test(current) ||
        current.startsWith(">") ||
        /^[-*]\s+/.test(current) ||
        /^\d+\.\s+/.test(current)
      ) {
        break;
      }
      paragraphLines.push(current);
      index++;
    }
    blocks.push({ type: "paragraph", lines: paragraphLines });
  }
  return blocks;
}

export function renderEmailMarkdown(
  md: string,
  opts: EmailMarkdownOptions = {},
): string {
  const parts: string[] = [];
  for (const block of parseBlocks(md)) {
    switch (block.type) {
      case "heading": {
        const tag = block.level === 3 ? "h3" : "h2";
        const style = block.level === 3 ? EMAIL_STYLE.h3 : EMAIL_STYLE.h2;
        parts.push(
          `<${tag} style="${style}">${renderInline(escapeEmailHtml(block.text), opts)}</${tag}>`,
        );
        break;
      }
      case "quote":
        parts.push(
          `<blockquote style="${EMAIL_STYLE.blockquote}">${block.lines
            .map((line) => renderInline(escapeEmailHtml(line), opts))
            .join("<br />")}</blockquote>`,
        );
        break;
      case "ul":
      case "ol":
        parts.push(
          `<${block.type} style="${EMAIL_STYLE.list}">${block.items
            .map(
              (item) =>
                `<li style="${EMAIL_STYLE.listItem}">${renderInline(escapeEmailHtml(item), opts)}</li>`,
            )
            .join("")}</${block.type}>`,
        );
        break;
      case "paragraph":
        parts.push(
          `<p style="${EMAIL_STYLE.paragraph}">${block.lines
            .map((line) => renderInline(escapeEmailHtml(line), opts))
            .join("<br />")}</p>`,
        );
        break;
    }
  }
  return parts.join("\n");
}

/** Plain-text part: markers stripped, structure kept, no HTML.
 *  [#NNNN] always degrades to `#id` — the text part carries no links
 *  beyond explicit [text](url) ones. */
export function renderEmailText(md: string): string {
  const inlineText = (raw: string): string =>
    raw
      .replace(/\[#(\d+)\]/g, "#$1")
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label: string, href: string) =>
        isSafeHref(href) ? `${label} (${href})` : label,
      )
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1");
  const parts: string[] = [];
  for (const block of parseBlocks(md)) {
    switch (block.type) {
      case "heading":
        parts.push(inlineText(block.text));
        break;
      case "quote":
        parts.push(block.lines.map((line) => `> ${inlineText(line)}`).join("\n"));
        break;
      case "ul":
        parts.push(block.items.map((item) => `- ${inlineText(item)}`).join("\n"));
        break;
      case "ol":
        parts.push(
          block.items
            .map((item, i) => `${i + 1}. ${inlineText(item)}`)
            .join("\n"),
        );
        break;
      case "paragraph":
        parts.push(block.lines.map(inlineText).join("\n"));
        break;
    }
  }
  return parts.join("\n\n");
}
