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

/** Plain-text fallback extraction (no HTML → no need for readability). */
export function stripHtml(html: string): string {
  if (!html) return "";
  try {
    const { document } = parseHTML(`<div>${html}</div>`);
    return document.body?.textContent?.trim() ?? "";
  } catch {
    return html.replace(/<[^>]+>/g, "").trim();
  }
}
