/**
 * Canonicalize a URL:
 * - lowercase host
 * - strip tracking params (utm_*, fbclid, gclid, ref, ref_src, mc_*, _hsenc, igshid)
 * - remove trailing slash
 * - remove fragment
 */
const TRACKING_PARAMS = [
  /^utm_/i,
  /^fbclid$/i,
  /^gclid$/i,
  /^ref$/i,
  /^ref_src$/i,
  /^mc_[cq]$/i,
  /^_hsenc$/i,
  /^_hsmi$/i,
  /^igshid$/i,
  /^mkt_tok$/i,
  /^vero_id$/i,
];

export function canonicalizeUrl(input: string): string {
  try {
    const u = new URL(input);
    u.hash = "";
    u.hostname = u.hostname.toLowerCase();
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.some((re) => re.test(key))) u.searchParams.delete(key);
    }
    let out = u.toString();
    // strip single trailing slash on bare-path URLs
    if (u.pathname === "/" && u.search === "" && u.hash === "") {
      out = out.replace(/\/$/, "");
    }
    return out;
  } catch {
    return input.trim();
  }
}
