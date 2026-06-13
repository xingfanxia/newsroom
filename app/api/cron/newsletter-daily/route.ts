import { runDailyColumn } from "@/workers/newsletter";
import { runCronJsonRoute } from "../_route";

export const maxDuration = 800;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  return runCronJsonRoute(req, async () => ({
    kind: "daily-column",
    report: await runDailyColumn(),
  }));
}
