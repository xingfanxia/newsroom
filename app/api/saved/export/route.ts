import { savedExportResponse } from "@/lib/api/saved-export";
import { runSessionRoute } from "@/lib/api/session-route";

/**
 * GET /api/saved/export?collection=<id|inbox|all> — dumps the user's saved
 * items as an attachment Markdown file. Columns are chosen for usefulness in
 * a reading queue: title, publisher, date, score, source URL, editor note when
 * present.
 */
export async function GET(req: Request) {
  return runSessionRoute(
    async (user) => savedExportResponse(req, user.id),
    { serverErrorLabel: "api/saved/export GET" },
  );
}
