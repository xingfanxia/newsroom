import { runNewsletterSend } from "@/workers/newsletter/send";
import { runCronJsonRoute } from "../_route";

export const maxDuration = 800;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  return runCronJsonRoute(req, async () => ({
    kind: "newsletter-send",
    report: await runNewsletterSend(),
  }));
}
