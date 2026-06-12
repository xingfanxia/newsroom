import { runFetchBucketCronRoute } from "../_fetch-bucket-route";

export const maxDuration = 800;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  return runFetchBucketCronRoute(req, {
    kind: "fetch-weekly",
    cadences: ["weekly"],
  });
}
