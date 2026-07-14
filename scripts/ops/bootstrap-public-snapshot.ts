import { open, readFile, rename, writeFile } from "node:fs/promises";
import { bootstrapPublicSnapshot, type BootstrapSpendLedger, type BootstrapSpendReservation } from "@/lib/public-content/publisher/bootstrap";
import {
  persistPublicPublisherReceipt,
  publicPublisherRunId,
  publicPublisherStoreFromEnvironment,
} from "@/lib/public-content/publisher/runtime";

type BootstrapArguments = {
  statePath: string;
  spendLedgerPath: string;
  sourceWatermark: number;
};

type SpendLedgerFile = {
  goalVersion: string;
  bootstrapSnapshots: { limit: number; used: number };
  objectWritesPerRun: number;
};

const R2_PUBLIC_GOAL_VERSION = "r2-public-read-v1-ec57c55fe111";

export class FileBootstrapSpendLedger implements BootstrapSpendLedger {
  constructor(readonly path: string) {}

  async reserveBootstrap(
    reservation: BootstrapSpendReservation,
  ): Promise<boolean> {
    const ledger = parseLedger(
      JSON.parse(await readFile(this.path, "utf8")) as unknown,
    );
    if (
      ledger.bootstrapSnapshots.limit !== 1 ||
      ledger.bootstrapSnapshots.used !== 0 ||
      reservation.objectWrites > ledger.objectWritesPerRun
    ) {
      return false;
    }
    const lockPath = `${this.path}.bootstrap-reserved`;
    let lock;
    try {
      lock = await open(lockPath, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
    await lock.writeFile(
      `${JSON.stringify({ ...reservation, reservedAt: new Date().toISOString() })}\n`,
    );
    await lock.sync();
    await lock.close();

    const updated: SpendLedgerFile = {
      ...ledger,
      bootstrapSnapshots: { ...ledger.bootstrapSnapshots, used: 1 },
    };
    const temporary = `${this.path}.tmp-${process.pid}`;
    await writeFile(temporary, `${JSON.stringify(updated, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(temporary, this.path);
    return true;
  }
}

export async function runBootstrapPublicSnapshotOperator(
  args: BootstrapArguments,
) {
  const now = Date.now;
  const runId = publicPublisherRunId(now());
  const store = publicPublisherStoreFromEnvironment();
  const state = JSON.parse(await readFile(args.statePath, "utf8")) as unknown;
  const receipt = await bootstrapPublicSnapshot({
    state,
    sourceWatermark: args.sourceWatermark,
    store,
    spendLedger: new FileBootstrapSpendLedger(args.spendLedgerPath),
    runId,
    now,
  });
  await persistPublicPublisherReceipt(store, receipt);
  return receipt;
}

export function parseBootstrapArguments(
  argv: readonly string[],
): BootstrapArguments {
  if (!argv.includes("--apply")) {
    throw new Error("bootstrap requires explicit --apply");
  }
  const statePath = flagValue(argv, "--state");
  const spendLedgerPath = flagValue(argv, "--spend-ledger");
  const sourceWatermark = Number(flagValue(argv, "--source-watermark"));
  if (!Number.isSafeInteger(sourceWatermark) || sourceWatermark < 0) {
    throw new Error("--source-watermark must be a non-negative integer");
  }
  return { statePath, spendLedgerPath, sourceWatermark };
}

function flagValue(argv: readonly string[], name: string): string {
  const index = argv.indexOf(name);
  const value = index < 0 ? undefined : argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} is required`);
  return value;
}

function parseLedger(value: unknown): SpendLedgerFile {
  if (value === null || typeof value !== "object") {
    throw new Error("invalid bootstrap spend ledger");
  }
  const ledger = value as Partial<SpendLedgerFile>;
  if (
    ledger.goalVersion !== R2_PUBLIC_GOAL_VERSION ||
    !ledger.bootstrapSnapshots ||
    ledger.bootstrapSnapshots.limit !== 1 ||
    !Number.isSafeInteger(ledger.bootstrapSnapshots.used) ||
    !Number.isSafeInteger(ledger.objectWritesPerRun) ||
    ledger.objectWritesPerRun! < 1
  ) {
    throw new Error("invalid bootstrap spend ledger");
  }
  return ledger as SpendLedgerFile;
}

async function main(): Promise<void> {
  console.log(
    JSON.stringify(
      await runBootstrapPublicSnapshotOperator(
        parseBootstrapArguments(process.argv.slice(2)),
      ),
      null,
      2,
    ),
  );
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
