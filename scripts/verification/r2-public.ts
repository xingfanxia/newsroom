import {
  verifyR2PublicCheap,
  verifyR2PublicCriterion,
} from "./r2-public-criteria";
import {
  renderFinalVerificationReport,
  verifyR2PublicFinal,
  writeFinalVerificationReport,
} from "./r2-public-final";
import { R2_PUBLIC_GOAL_VERSION } from "@/scripts/ops/public-evidence";
import { resolve } from "node:path";

interface CliArguments {
  criterion?: string;
  cheap: boolean;
  final: boolean;
}

function parseArguments(argv: readonly string[]): CliArguments {
  if (argv.length === 1 && argv[0] === "--final") {
    return { cheap: false, final: true };
  }
  if (argv.length === 1 && argv[0] === "--cheap") {
    return { cheap: true, final: false };
  }
  if (argv.length === 2 && argv[0] === "--criterion" && argv[1]) {
    return { criterion: argv[1], cheap: false, final: false };
  }
  throw new Error(
    "Usage: bun run verify:r2-public --cheap | --criterion AC-NNN | --final",
  );
}

async function main(): Promise<void> {
  try {
    const options = parseArguments(Bun.argv.slice(2));
    if (options.final) {
      const root = resolve(import.meta.dir, "../..");
      const result = await verifyR2PublicFinal(root);
      for (const criterion of result.criteria) {
        for (const receipt of criterion.receipts) {
          process.stdout.write(`[${criterion.criterion}] ${receipt}\n`);
        }
      }
      const report = renderFinalVerificationReport(result, {
        goalVersion: R2_PUBLIC_GOAL_VERSION,
      });
      const reportPath = writeFinalVerificationReport(root, report);
      process.stdout.write(`[FINAL] wrote ${reportPath}\nFINAL_COMPLETE\n`);
      return;
    }

    const result = options.cheap
      ? await verifyR2PublicCheap()
      : await verifyR2PublicCriterion(options.criterion as string);
    for (const receipt of result.receipts) {
      process.stdout.write(`[${result.criterion}] ${receipt}\n`);
    }
    process.stdout.write(`${result.criterion}_COMPLETE\n`);
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "R2 public verification failed";
    process.stderr.write(`[r2-public] ${message}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.main) await main();
