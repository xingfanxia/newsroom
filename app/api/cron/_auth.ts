import { NextResponse } from "next/server";

/**
 * Cron invocations from Vercel include:
 *   authorization: Bearer <CRON_SECRET>
 * where CRON_SECRET is auto-set on projects with cron jobs.
 *
 * We also allow a manual trigger with the same header for local/ops use.
 */
export function verifyCron(req: Request): NextResponse | null {
  const auth = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;

  // If no secret is set (first deploy before cron init), allow only in dev
  if (!secret) {
    if (process.env.NODE_ENV === "development") return null;
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 500 },
    );
  }

  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}
