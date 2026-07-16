/**
 * Escaping primitives for email HTML — the single source of truth
 * (markdown renderer + templates both import from here; a duplicated
 * escape function drifts silently).
 */
export function escapeEmailHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Only http(s) URLs may become hrefs — feed/LLM content is untrusted. */
export function isSafeHref(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/** Subjects are header sinks, not HTML sinks: strip control chars and
 *  newlines (defense-in-depth against header-shaped LLM output). */
export function subjectSafe(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
}
