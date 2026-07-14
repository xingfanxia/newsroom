import {
  verifyR2PublicCheap,
  verifyR2PublicCriterion,
} from "./r2-public-criteria";

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
      throw new Error(
        "Final verification is unavailable until every criterion implementation exists.",
      );
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
