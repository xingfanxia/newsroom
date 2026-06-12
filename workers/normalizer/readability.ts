import { parseHTML } from "linkedom";
import { createHash } from "node:crypto";

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
