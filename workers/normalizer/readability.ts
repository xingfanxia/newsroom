import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";
import { createHash } from "node:crypto";

export type NormalizedContent = {
  title: string;
  body: string;
  author: string | null;
  excerpt: string | null;
};

/**
 * Extract article content from HTML using Mozilla Readability.
 * Returns a fallback object if extraction fails (body = "", title from input).
 */
export function extractReadable(html: string, fallbackTitle?: string): NormalizedContent {
  try {
    const { document } = parseHTML(html);
    // linkedom's DOM is broadly compatible with Readability; cast appeases TS without a runtime shim
    const reader = new Readability(document as unknown as Document, {
      keepClasses: false,
    });
    const article = reader.parse();
    if (!article) {
      return {
        title: fallbackTitle ?? "(untitled)",
        body: "",
        author: null,
        excerpt: null,
      };
    }
    return {
      title: article.title?.trim() || fallbackTitle || "(untitled)",
      body: article.textContent?.trim() ?? "",
      author: article.byline?.trim() || null,
      excerpt: article.excerpt?.trim() || null,
    };
  } catch {
    return {
      title: fallbackTitle ?? "(untitled)",
      body: "",
      author: null,
      excerpt: null,
    };
  }
}

export function contentHash(title: string, body: string): string {
  return createHash("sha256").update(`${title}\n\n${body}`).digest("hex");
}

/** Plain-text fallback extraction (no HTML → no need for readability).
 *
 * Linkedom's `parseHTML('<div>...')` returns a document with `body === null`
 * unless the input contains a full `<html><body>...` skeleton, so the old
 * one-line wrap silently dropped every RSS/tweet body to `""`. We now:
 *   1. Bypass parsing entirely when the input has no tag markers — pure
 *      text (tweets, plain-text snippets) flows through unchanged.
 *   2. Wrap with `<html><body>` so linkedom always has a body to read from.
 *   3. Fall back to a regex strip if the parser returns empty text despite
 *      non-empty input.
 */
export function stripHtml(html: string): string {
  if (!html) return "";
  const trimmed = html.trim();
  if (!trimmed) return "";
  // Heuristic: any `<letter`, `</`, or `<!` marks possible HTML. Otherwise
  // treat as plain text — parsing adds no value and may mangle Unicode.
  if (!/<[a-zA-Z!/]/.test(trimmed)) return trimmed;
  try {
    const { document } = parseHTML(`<html><body>${trimmed}</body></html>`);
    const text = document.body?.textContent?.trim();
    if (text && text.length > 0) return text;
  } catch {
    // fall through
  }
  return trimmed.replace(/<[^>]+>/g, "").trim();
}
