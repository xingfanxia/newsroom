import { runIncrementalPublicPublisher } from "@/lib/public-content/publisher/runtime";

export async function runPublishPublicSnapshotOperator() {
  return runIncrementalPublicPublisher();
}

async function main(): Promise<void> {
  console.log(
    JSON.stringify(await runPublishPublicSnapshotOperator(), null, 2),
  );
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
