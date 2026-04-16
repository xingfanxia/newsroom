import { NextResponse } from "next/server";
import { runNormalizer } from "@/workers/normalizer";
import { verifyCron } from "../_auth";

export const maxDuration = 800;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Standalone normalize catch-up, in case some raw_items stay unnormalized. */
export async function GET(req: Request) {
  const deny = verifyCron(req);
  if (deny) return deny;

  const report = await runNormalizer();
  return NextResponse.json({
    kind: "normalize",
    at: new Date().toISOString(),
    normalize: report,
  });
}
