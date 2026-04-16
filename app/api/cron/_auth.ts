import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

/**
 * Cron invocations from Vercel include:
 *   authorization: Bearer <CRON_SECRET>
 *
 * We compare in constant time. In dev without CRON_SECRET, allow unauthenticated;
 * in any other environment (production/preview), require it.
 */
export function verifyCron(req: Request): NextResponse | null {
  const auth = (req.headers.get("authorization") ?? "").trim();
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    if (process.env.NODE_ENV === "development") return null;
    return NextResponse.json(
      { error: "cron_secret_unset" },
      { status: 500 },
    );
  }

  const expected = `Bearer ${secret}`;
  if (!constantTimeEqual(auth, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) {
    // Still do a fake compare so total time is closer to the same-length path.
    timingSafeEqual(bBuf, bBuf);
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}
