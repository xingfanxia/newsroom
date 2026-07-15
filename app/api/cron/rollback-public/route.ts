import { publicPublisherStoreFromEnvironment } from "@/lib/public-content/publisher/runtime";
import {
  swapPublicPointerToPrevious,
  type PublicPointerRollbackReceipt,
} from "@/lib/public-content/publisher/rollback-pointer";
import { runCronJsonRoute } from "../_route";

export const maxDuration = 60;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RollbackRunner = () => Promise<PublicPointerRollbackReceipt>;

export function handleRollbackPublicCron(
  request: Request,
  run: RollbackRunner = () =>
    swapPublicPointerToPrevious(publicPublisherStoreFromEnvironment()),
): Promise<Response> {
  return runCronJsonRoute(request, async () => ({
    kind: "rollback-public",
    receipt: await run(),
  }));
}

export function POST(request: Request): Promise<Response> {
  return handleRollbackPublicCron(request);
}
