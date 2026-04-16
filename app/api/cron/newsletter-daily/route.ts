import { NextResponse } from "next/server";
import { runNewsletterBatch } from "@/workers/newsletter";
import { verifyCron } from "../_auth";

export const maxDuration = 800;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const deny = verifyCron(req);
  if (deny) return deny;

  const report = await runNewsletterBatch("daily");
  return NextResponse.json({
    kind: "newsletter-daily",
    at: new Date().toISOString(),
    newsletter: report,
  });
}
