import { adminLogoutResponse } from "@/lib/api/admin-session-routes";

export const dynamic = "force-dynamic";

/** POST /api/admin/logout — drop the admin session cookie. */
export async function POST() {
  return adminLogoutResponse();
}
