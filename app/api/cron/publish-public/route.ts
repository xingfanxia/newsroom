import { runIncrementalPublicPublisher } from "@/lib/public-content/publisher/runtime";
import type { PublicPublisherReceipt } from "@/lib/public-content/publisher/publish";
import { runCronJsonRoute } from "../_route";

export const maxDuration = 300;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type PublishRunner = () => Promise<PublicPublisherReceipt>;

export function handlePublishPublicCron(
  request: Request,
  run: PublishRunner = runIncrementalPublicPublisher,
): Promise<Response> {
  return runCronJsonRoute(request, async () => ({
    kind: "publish-public",
    receipt: await run(),
  }));
}

export function GET(request: Request): Promise<Response> {
  return handlePublishPublicCron(request);
}
