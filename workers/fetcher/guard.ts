import net from "node:net";
import { lookup } from "node:dns/promises";

export class GuardError extends Error {
  constructor(public code: string) {
    super(code);
    this.name = "GuardError";
  }
}

/**
 * Block private/reserved IP ranges to prevent SSRF.
 * Covers IPv4 and IPv6 private/loopback/link-local/multicast/reserved.
 */
export function isBlockedIp(ip: string): boolean {
  if (!net.isIP(ip)) return false;

  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10/8
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local / AWS IMDS
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
    if (a === 192 && b === 168) return true; // 192.168/16
    if (a === 100 && b >= 64 && b <= 127) return true; // CG-NAT
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a >= 224) return true; // multicast + reserved
    return false;
  }

  // IPv6
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA
  // fe80::/10 link-local — prefix: fe8, fe9, fea, feb
  if (
    lower.startsWith("fe8") ||
    lower.startsWith("fe9") ||
    lower.startsWith("fea") ||
    lower.startsWith("feb")
  ) {
    return true;
  }
  // IPv4-mapped: ::ffff:a.b.c.d
  if (lower.startsWith("::ffff:")) {
    return isBlockedIp(lower.slice(7));
  }
  return false;
}

/**
 * Validate that a URL is safe to fetch from a worker:
 *  - scheme must be http(s)
 *  - hostname must not resolve to a private / loopback / link-local IP
 *
 * Called before every fetch and on every redirect hop.
 */
export async function guardUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new GuardError("invalid_url");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new GuardError("invalid_scheme");
  }

  const host = u.hostname;
  if (!host) throw new GuardError("empty_host");

  // Literal IP: check directly
  if (net.isIP(host)) {
    if (isBlockedIp(host)) throw new GuardError("blocked_ip_literal");
    return u;
  }

  // Reject bracketed IPv6 literals wrapped in URL host (net.isIP doesn't see them with brackets)
  if (host.startsWith("[") && host.endsWith("]")) {
    const inner = host.slice(1, -1);
    if (net.isIP(inner) && isBlockedIp(inner)) {
      throw new GuardError("blocked_ip_literal");
    }
    return u;
  }

  // DNS-resolve hostname
  let resolved: { address: string; family: number }[];
  try {
    resolved = await lookup(host, { all: true, family: 0 });
  } catch {
    throw new GuardError("dns_lookup_failed");
  }
  for (const r of resolved) {
    if (isBlockedIp(r.address)) {
      throw new GuardError("blocked_resolved_ip");
    }
  }
  return u;
}
