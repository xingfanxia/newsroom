import { NextResponse } from "next/server";
import { runDailyColumn } from "@/workers/newsletter";
import { verifyCron } from "../_auth";

export const maxDuration = 800;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const deny = verifyCron(req);
  if (deny) return deny;

  const report = await runDailyColumn();
  return NextResponse.json({
    kind: "daily-column",
    at: new Date().toISOString(),
    report,
  });
}
