import { readFileSync } from "node:fs";
import { z } from "zod";
import {
  assertExplicitIntegrationOptIn,
  assertPublicSpendReservation,
  readPublicSpendLedger,
  requireApply,
  requiredFlagValue,
  writePublicEvidenceReceipt,
  type PublicSpendLedger,
} from "./public-evidence";

const MONTH_HOURS = 730;
export const HARD_ROWS_PER_HOUR = 136_986;
export const PREFERRED_ROWS_PER_HOUR = 13_699;

export const tursoUsageSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("turso-usage-snapshot"),
  windowName: z.string().min(1),
  lane: z.enum(["load", "control", "clean"]),
  phase: z.enum(["from", "to"]),
  database: z.string().min(1),
  capturedAt: z.string().datetime(),
  rowsRead: z.number().int().nonnegative().safe(),
  rowsWritten: z.number().int().nonnegative().safe(),
});

export const tursoWindowReceiptSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal("turso-window"),
    windowName: z.string().min(1),
    lane: z.enum(["load", "control", "clean"]),
    database: z.string().min(1),
    fromAt: z.string().datetime(),
    toAt: z.string().datetime(),
    durationHours: z.number().positive(),
    deltaRowsRead: z.number().int().nonnegative(),
    rowsPerHour: z.number().nonnegative(),
    projectedMonthlyRows: z.number().nonnegative(),
    hardTargetMet: z.boolean(),
    preferredTargetMet: z.boolean(),
  })
  .superRefine((receipt, context) => {
    const durationHours =
      (Date.parse(receipt.toAt) - Date.parse(receipt.fromAt)) / 3_600_000;
    const rowsPerHour = receipt.deltaRowsRead / receipt.durationHours;
    const derived = [
      ["durationHours", receipt.durationHours, durationHours],
      ["rowsPerHour", receipt.rowsPerHour, rowsPerHour],
      ["projectedMonthlyRows", receipt.projectedMonthlyRows, rowsPerHour * MONTH_HOURS],
    ] as const;
    for (const [field, actual, expected] of derived) {
      if (!approximatelyEqual(actual, expected)) {
        context.addIssue({ code: "custom", path: [field], message: `${field} is not derived from the exact window` });
      }
    }
    if (receipt.hardTargetMet !== (rowsPerHour < HARD_ROWS_PER_HOUR)) {
      context.addIssue({ code: "custom", path: ["hardTargetMet"], message: "hard target verdict is inconsistent" });
    }
    if (receipt.preferredTargetMet !== (rowsPerHour < PREFERRED_ROWS_PER_HOUR)) {
      context.addIssue({ code: "custom", path: ["preferredTargetMet"], message: "preferred target verdict is inconsistent" });
    }
  });

export const tursoLoadComparisonSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal("turso-load-comparison"),
    windowName: z.string().min(1),
    database: z.string().min(1),
    durationHours: z.number().positive(),
    loadDeltaRowsRead: z.number().int().nonnegative(),
    controlDeltaRowsRead: z.number().int().nonnegative(),
    netDeltaRowsRead: z.number().int(),
    decoupled: z.boolean(),
  })
  .superRefine((receipt, context) => {
    const net = receipt.loadDeltaRowsRead - receipt.controlDeltaRowsRead;
    if (receipt.netDeltaRowsRead !== net) {
      context.addIssue({ code: "custom", path: ["netDeltaRowsRead"], message: "net delta is inconsistent" });
    }
    if (receipt.decoupled !== (net === 0)) {
      context.addIssue({ code: "custom", path: ["decoupled"], message: "decoupling verdict is inconsistent" });
    }
  });

export type TursoUsageSnapshot = z.infer<typeof tursoUsageSnapshotSchema>;
export type TursoWindowReceipt = z.infer<typeof tursoWindowReceiptSchema>;
export type TursoLoadComparison = z.infer<typeof tursoLoadComparisonSchema>;

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export async function captureTursoUsage(options: {
  readonly database: string;
  readonly fetch?: FetchLike;
  readonly lane: TursoUsageSnapshot["lane"];
  readonly ledger: PublicSpendLedger;
  readonly now?: () => number;
  readonly org: string;
  readonly phase: TursoUsageSnapshot["phase"];
  readonly token: string;
}): Promise<TursoUsageSnapshot> {
  if (options.ledger.tursoWindowName === null) {
    throw new Error("Turso capture requires a named window in the spend ledger");
  }
  assertPublicSpendReservation(options.ledger, {
    bootstrapSnapshots: 0,
    publicHttpRequests: 0,
    r2ObjectWrites: 0,
    transferBytes: options.ledger.planned.transferBytes,
    requiresTursoWindow: true,
  });
  const apiUrl = `https://api.turso.tech/v1/organizations/${encodeURIComponent(options.org)}/databases/${encodeURIComponent(options.database)}/usage`;
  assertExplicitIntegrationOptIn(apiUrl);
  const response = await (options.fetch ?? fetch)(apiUrl, {
    headers: { Authorization: `Bearer ${options.token}` },
  });
  if (!response.ok) throw new Error(`Turso usage request failed: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > options.ledger.planned.transferBytes) {
    throw new Error("spend ledger transferBytes reservation exceeded");
  }
  const usage = parseTursoUsage(JSON.parse(new TextDecoder().decode(bytes)));
  return tursoUsageSnapshotSchema.parse({
    schemaVersion: 1,
    kind: "turso-usage-snapshot",
    windowName: options.ledger.tursoWindowName,
    lane: options.lane,
    phase: options.phase,
    database: options.database,
    capturedAt: new Date((options.now ?? Date.now)()).toISOString(),
    rowsRead: usage.rowsRead,
    rowsWritten: usage.rowsWritten,
  });
}

export function measureTursoWindow(
  fromValue: unknown,
  toValue: unknown,
): TursoWindowReceipt {
  const from = tursoUsageSnapshotSchema.parse(fromValue);
  const to = tursoUsageSnapshotSchema.parse(toValue);
  if (
    from.windowName !== to.windowName ||
    from.database !== to.database ||
    from.lane !== to.lane ||
    from.phase !== "from" ||
    to.phase !== "to"
  ) {
    throw new Error("Turso window endpoints do not describe one exact lane");
  }
  const elapsedMs = Date.parse(to.capturedAt) - Date.parse(from.capturedAt);
  const deltaRowsRead = to.rowsRead - from.rowsRead;
  if (elapsedMs <= 0 || deltaRowsRead < 0) {
    throw new Error("Turso window must move forward without a billing reset");
  }
  const durationHours = elapsedMs / 3_600_000;
  const rowsPerHour = deltaRowsRead / durationHours;
  return tursoWindowReceiptSchema.parse({
    schemaVersion: 1,
    kind: "turso-window",
    windowName: from.windowName,
    lane: from.lane,
    database: from.database,
    fromAt: from.capturedAt,
    toAt: to.capturedAt,
    durationHours,
    deltaRowsRead,
    rowsPerHour,
    projectedMonthlyRows: rowsPerHour * MONTH_HOURS,
    hardTargetMet: rowsPerHour < HARD_ROWS_PER_HOUR,
    preferredTargetMet: rowsPerHour < PREFERRED_ROWS_PER_HOUR,
  });
}

export function compareTursoLoadToControl(
  loadFrom: unknown,
  loadTo: unknown,
  controlFrom: unknown,
  controlTo: unknown,
): TursoLoadComparison {
  const load = measureTursoWindow(loadFrom, loadTo);
  const control = measureTursoWindow(controlFrom, controlTo);
  if (
    load.database !== control.database ||
    load.windowName !== control.windowName ||
    load.lane !== "load" ||
    control.lane !== "control" ||
    Math.abs(load.durationHours - control.durationHours) > 1 / 3_600
  ) {
    throw new Error("load and control Turso windows must be equal and paired");
  }
  const netDeltaRowsRead = load.deltaRowsRead - control.deltaRowsRead;
  return tursoLoadComparisonSchema.parse({
    schemaVersion: 1,
    kind: "turso-load-comparison",
    windowName: load.windowName,
    database: load.database,
    durationHours: load.durationHours,
    loadDeltaRowsRead: load.deltaRowsRead,
    controlDeltaRowsRead: control.deltaRowsRead,
    netDeltaRowsRead,
    decoupled: netDeltaRowsRead === 0,
  });
}

function parseTursoUsage(value: unknown): {
  rowsRead: number;
  rowsWritten: number;
} {
  const body = value as {
    database?: { usage?: { rows_read?: unknown; rows_written?: unknown } };
    total?: { rows_read?: unknown; rows_written?: unknown };
  } | null;
  const usage = body?.database?.usage ?? body?.total;
  const rowsRead = usage?.rows_read;
  const rowsWritten = usage?.rows_written ?? 0;
  if (
    typeof rowsRead !== "number" ||
    !Number.isSafeInteger(rowsRead) ||
    rowsRead < 0 ||
    typeof rowsWritten !== "number" ||
    !Number.isSafeInteger(rowsWritten) ||
    rowsWritten < 0
  ) {
    throw new Error("Turso usage response has invalid counters");
  }
  return { rowsRead, rowsWritten };
}

function approximatelyEqual(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= Math.max(1e-9, Math.abs(expected) * 1e-9);
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

async function main(argv: readonly string[]): Promise<void> {
  requireApply(argv);
  const mode = requiredFlagValue(argv, "--mode");
  const output = requiredFlagValue(argv, "--receipt");
  if (mode === "capture") {
    const ledger = readPublicSpendLedger(
      requiredFlagValue(argv, "--spend-ledger"),
    );
    const token = process.env.TURSO_API_TOKEN;
    if (!token) throw new Error("TURSO_API_TOKEN is required for capture");
    const lane = tursoUsageSnapshotSchema.shape.lane.parse(
      requiredFlagValue(argv, "--lane"),
    );
    const phase = tursoUsageSnapshotSchema.shape.phase.parse(
      requiredFlagValue(argv, "--phase"),
    );
    const receipt = await captureTursoUsage({
      database: requiredFlagValue(argv, "--database"),
      lane,
      ledger,
      org: requiredFlagValue(argv, "--org"),
      phase,
      token,
    });
    writePublicEvidenceReceipt(output, receipt);
    console.log(JSON.stringify(receipt, null, 2));
    return;
  }
  const from = readJson(requiredFlagValue(argv, "--from"));
  const to = readJson(requiredFlagValue(argv, "--to"));
  const receipt =
    mode === "window"
      ? measureTursoWindow(from, to)
      : mode === "compare"
        ? compareTursoLoadToControl(
            from,
            to,
            readJson(requiredFlagValue(argv, "--control-from")),
            readJson(requiredFlagValue(argv, "--control-to")),
          )
        : null;
  if (!receipt) throw new Error("--mode must be capture, window or compare");
  writePublicEvidenceReceipt(output, receipt);
  console.log(JSON.stringify(receipt, null, 2));
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
