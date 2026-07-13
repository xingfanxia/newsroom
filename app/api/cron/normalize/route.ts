import { runNormalizer } from "@/workers/normalizer";
import { runCronJsonRoute } from "../_route";

export const maxDuration = 800;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Standalone normalize catch-up, in case some raw_items stay unnormalized. */
export async function GET(req: Request) {
  return runCronJsonRoute(
    req,
    async () => ({
      kind: "normalize",
      normalize: await runNormalizer(),
    }),
    { revalidateFeed: true },
  );
}
