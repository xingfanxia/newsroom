import { ADMIN_USER_ID, getSessionUser } from "@/lib/auth/session";
import { savedExportResponse } from "@/lib/api/saved-export";

/**
 * GET /api/saved/export?collection=<id|inbox|all> — dumps the user's saved
 * items as an attachment Markdown file. Columns are chosen for usefulness in
 * a reading queue: title, publisher, date, score, source URL, editor note when
 * present.
 */
export async function GET(req: Request) {
  const user = await getSessionUser();
  const userId = user?.id ?? ADMIN_USER_ID;
  return savedExportResponse(req, userId);
}
