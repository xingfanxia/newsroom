import { plainJson, plainServerError } from "@/lib/api/plain-response";
import { getActiveSourcesRoutePayload } from "@/lib/api/source-catalog";

export const revalidate = 300;

/**
 * Public list of enabled sources for the in-app source picker. Returns only
 * the fields needed to render + filter (id, names, kind, group). URLs and
 * notes are omitted — the bearer-gated /api/v1/sources still carries the
 * full catalog + health for external agents.
 */
export async function GET() {
  try {
    return plainJson(await getActiveSourcesRoutePayload());
  } catch (err) {
    return plainServerError("api/sources/active", err);
  }
}
