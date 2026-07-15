import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";

export const R2_PUBLIC_GOAL_VERSION = "r2-public-read-v1-ec57c55fe111";
export const PUBLIC_SPEND_CAPS = Object.freeze({
  bootstrapSnapshots: 1,
  publicHttpRequests: 10_000,
  r2ObjectWrites: 500,
  transferBytes: 1_073_741_824,
});

const nonNegativeInteger = z.number().int().nonnegative().safe();

export const spendLedgerSchema = z.strictObject({
  schemaVersion: z.literal(1),
  goalVersion: z.literal(R2_PUBLIC_GOAL_VERSION),
  runId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/),
  plannedAt: z.string().datetime(),
  planned: z.strictObject({
    bootstrapSnapshots: nonNegativeInteger.max(
      PUBLIC_SPEND_CAPS.bootstrapSnapshots,
    ),
    publicHttpRequests: nonNegativeInteger.max(
      PUBLIC_SPEND_CAPS.publicHttpRequests,
    ),
    r2ObjectWrites: nonNegativeInteger.max(
      PUBLIC_SPEND_CAPS.r2ObjectWrites,
    ),
    transferBytes: nonNegativeInteger.max(PUBLIC_SPEND_CAPS.transferBytes),
  }),
  tursoWindowName: z
    .string()
    .regex(/^[a-z0-9][a-z0-9._-]{0,127}$/)
    .nullable(),
});

export type PublicSpendLedger = z.infer<typeof spendLedgerSchema>;
export type PublicSpendReservation = PublicSpendLedger["planned"] & {
  readonly requiresTursoWindow?: boolean;
};

export function readPublicSpendLedger(path: string): PublicSpendLedger {
  return spendLedgerSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

export function assertPublicSpendReservation(
  ledger: PublicSpendLedger,
  reservation: PublicSpendReservation,
): void {
  const keys = [
    "bootstrapSnapshots",
    "publicHttpRequests",
    "r2ObjectWrites",
    "transferBytes",
  ] as const;
  for (const key of keys) {
    const value = reservation[key];
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`invalid spend reservation: ${key}`);
    }
    if (value > PUBLIC_SPEND_CAPS[key]) {
      throw new Error(`spend cap exceeded: ${key}`);
    }
    if (value > ledger.planned[key]) {
      throw new Error(`spend ledger under-reserved: ${key}`);
    }
  }
  if (reservation.requiresTursoWindow && !ledger.tursoWindowName) {
    throw new Error("intentional Turso measurement requires a named exact window");
  }
}

export function assertExplicitIntegrationOptIn(url: string): void {
  const parsed = new URL(url);
  const loopback = ["127.0.0.1", "localhost", "[::1]", "::1"].includes(
    parsed.hostname.toLowerCase(),
  );
  if (loopback) return;
  if (parsed.protocol !== "https:") {
    throw new Error("non-loopback evidence endpoints must use HTTPS");
  }
  if (process.env.RUN_PRODUCTION_INTEGRATION !== "1") {
    throw new Error(
      "external evidence run requires RUN_PRODUCTION_INTEGRATION=1",
    );
  }
}

export function writePublicEvidenceReceipt(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
}

export function requiredFlagValue(
  argv: readonly string[],
  name: string,
): string {
  const index = argv.indexOf(name);
  const value = index < 0 ? undefined : argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} is required`);
  return value;
}

export function requireApply(argv: readonly string[]): void {
  if (!argv.includes("--apply")) {
    throw new Error("evidence execution requires explicit --apply");
  }
}
