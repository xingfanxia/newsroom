import { reconcilePublicSnapshot } from "@/lib/public-content/publisher/reconcile";
import { publicPublisherStoreFromEnvironment } from "@/lib/public-content/publisher/runtime";

export async function runReconcilePublicSnapshotOperator(maxArtifacts = 100) {
  return reconcilePublicSnapshot(publicPublisherStoreFromEnvironment(), {
    maxArtifacts,
  });
}

function maxArtifactsArgument(argv: readonly string[]): number {
  const index = argv.indexOf("--max-artifacts");
  if (index < 0) return 100;
  const value = Number(argv[index + 1]);
  if (!Number.isSafeInteger(value)) {
    throw new Error("--max-artifacts must be an integer");
  }
  return value;
}

async function main(): Promise<void> {
  const receipt = await runReconcilePublicSnapshotOperator(
    maxArtifactsArgument(process.argv.slice(2)),
  );
  console.log(JSON.stringify(receipt, null, 2));
  if (receipt.status === "failed") process.exitCode = 1;
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
