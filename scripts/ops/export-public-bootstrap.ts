import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { closeDb, libsqlClient } from "@/db/client";
import { canonicalJsonBytes } from "@/lib/public-content/canonical";
import { exportCanonicalPublicState } from "@/lib/public-content/publisher/source";

type ExportArguments = { outputPath: string; pageSize: number };

export async function runPublicBootstrapExport(args: ExportArguments) {
  const exported = await exportCanonicalPublicState(libsqlClient(), {
    pageSize: args.pageSize,
  });
  const bytes = canonicalJsonBytes(exported.state);
  const handle = await open(args.outputPath, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  return {
    outputPath: args.outputPath,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sourceWatermark: exported.sourceWatermark,
    counts: {
      items: exported.state.items.length,
      events: exported.state.events.length,
      sources: exported.state.sources.length,
      newsletters: exported.state.newsletters.length,
      policies: exported.state.policies.length,
    },
    telemetry: exported.telemetry,
  };
}

export function parsePublicBootstrapExportArguments(
  argv: readonly string[],
): ExportArguments {
  if (!argv.includes("--apply")) {
    throw new Error("bootstrap export requires explicit --apply");
  }
  const outputPath = flagValue(argv, "--output");
  const pageSizeValue = optionalFlagValue(argv, "--page-size") ?? "250";
  const pageSize = Number(pageSizeValue);
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 500) {
    throw new Error("--page-size must be an integer from 1 to 500");
  }
  return { outputPath, pageSize };
}

function flagValue(argv: readonly string[], name: string): string {
  const value = optionalFlagValue(argv, name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optionalFlagValue(
  argv: readonly string[],
  name: string,
): string | null {
  const index = argv.indexOf(name);
  const value = index < 0 ? undefined : argv[index + 1];
  return !value || value.startsWith("--") ? null : value;
}

async function main(): Promise<void> {
  try {
    console.log(
      JSON.stringify(
        await runPublicBootstrapExport(
          parsePublicBootstrapExportArguments(process.argv.slice(2)),
        ),
      ),
    );
  } finally {
    await closeDb();
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
