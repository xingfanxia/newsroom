import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { runReceiptSchema } from "@/lib/public-content/contracts";
import {
  anonymousLoadReceiptSchema,
  type AnonymousLoadReceipt,
} from "./load-anonymous";
import {
  assertR2CacheReceipt,
  type R2CacheReceipt,
} from "./verify-r2-cache";
import {
  tursoLoadComparisonSchema,
  tursoWindowReceiptSchema,
  type TursoLoadComparison,
} from "./measure-turso-window";
import {
  requireApply,
  requiredFlagValue,
  writePublicEvidenceReceipt,
} from "./public-evidence";
import { buildAnonymousLoadPlan } from "@/scripts/verification/public-runtime-corpus";

const evidenceManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  cacheReceipt: z.string().min(1),
  loadReceipts: z.array(z.string().min(1)).min(1),
  tursoLoadComparisons: z.array(z.string().min(1)).min(1),
  cleanTursoWindow: z.string().min(1),
  publisherReceipts: z.array(z.string().min(1)).min(1),
  publisherWindowHours: z.number().positive(),
});

export const publicCutoverVerdictSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("public-cutover-verdict"),
  ac004: z.boolean(),
  ac011: z.boolean(),
  ac012: z.boolean(),
  preferredTargetMet: z.boolean(),
  publisherProjectedMonthlyRows: z.number().nonnegative(),
  totalTursoProjectedMonthlyRows: z.number().nonnegative(),
  issues: z.array(z.string()),
});

export type PublicCutoverVerdict = z.infer<typeof publicCutoverVerdictSchema>;

export function verifyPublicCutoverEvidence(
  manifestPath: string,
): PublicCutoverVerdict {
  const manifest = evidenceManifestSchema.parse(readJson(manifestPath));
  const base = dirname(resolve(manifestPath));
  const cache = assertR2CacheReceipt(readRelative(base, manifest.cacheReceipt));
  const loads = manifest.loadReceipts.map((path) =>
    anonymousLoadReceiptSchema.parse(readRelative(base, path)),
  );
  const comparisons = manifest.tursoLoadComparisons.map((path) =>
    tursoLoadComparisonSchema.parse(readRelative(base, path)),
  );
  const clean = tursoWindowReceiptSchema.parse(
    readRelative(base, manifest.cleanTursoWindow),
  );
  const publisherReceipts = manifest.publisherReceipts.map((path) =>
    runReceiptSchema.parse(readRelative(base, path)),
  );
  const issues: string[] = [];
  const ac004 = cacheIsComplete(cache, issues);
  const ac011 = loadEvidenceIsComplete(loads, comparisons, issues);
  const publisherProjectedMonthlyRows =
    (publisherReceipts.reduce(
      (total, receipt) => total + receipt.rows.scannedRows,
      0,
    ) /
      manifest.publisherWindowHours) *
    730;
  const invalidPublisherReceipt = publisherReceipts.find(
    (receipt) =>
      receipt.mode !== "incremental" ||
      (receipt.status !== "succeeded" && receipt.status !== "noop"),
  );
  if (invalidPublisherReceipt) {
    issues.push("publisher evidence contains a failed or non-incremental run");
  }
  if (clean.database !== "newsroom-v2") {
    issues.push("clean Turso window is not for newsroom-v2");
  }
  if (clean.lane !== "clean" || clean.durationHours < 24) {
    issues.push("clean Turso window must cover at least 24 hours");
  }
  if (!clean.hardTargetMet) issues.push("clean Turso window exceeds 100M/month");
  if (publisherProjectedMonthlyRows >= 5_000_000) {
    issues.push("publisher projection exceeds 5M/month");
  }
  const ac012 =
    clean.lane === "clean" &&
    clean.database === "newsroom-v2" &&
    clean.durationHours >= 24 &&
    clean.hardTargetMet &&
    !invalidPublisherReceipt &&
    publisherProjectedMonthlyRows < 5_000_000;
  return publicCutoverVerdictSchema.parse({
    schemaVersion: 1,
    kind: "public-cutover-verdict",
    ac004,
    ac011,
    ac012,
    preferredTargetMet: clean.preferredTargetMet,
    publisherProjectedMonthlyRows,
    totalTursoProjectedMonthlyRows: clean.projectedMonthlyRows,
    issues,
  });
}

export function assertPublicEvidenceCriterion(
  criterion: "AC-004" | "AC-011" | "AC-012",
  manifestPath: string,
): PublicCutoverVerdict {
  const verdict = verifyPublicCutoverEvidence(manifestPath);
  const passed =
    criterion === "AC-004"
      ? verdict.ac004
      : criterion === "AC-011"
        ? verdict.ac011
        : verdict.ac012;
  if (!passed) {
    throw new Error(`${criterion} production evidence is incomplete: ${verdict.issues.join("; ")}`);
  }
  return verdict;
}

function cacheIsComplete(cache: R2CacheReceipt, issues: string[]): boolean {
  const pointer = new URL(cache.pointerUrl);
  const immutable = new URL(cache.immutableUrl);
  if (
    cache.origin !== "https://news.ax0x.ai" ||
    pointer.protocol !== "https:" ||
    immutable.protocol !== "https:" ||
    pointer.hostname !== "content.ax0x.ai" ||
    immutable.hostname !== "content.ax0x.ai"
  ) {
    issues.push("cache receipt is not from the production public/content origins");
    return false;
  }
  return true;
}

function loadEvidenceIsComplete(
  loads: readonly AnonymousLoadReceipt[],
  comparisons: readonly TursoLoadComparison[],
  issues: string[],
): boolean {
  const multipliers = new Set(loads.map(({ multiplier }) => multiplier));
  const scenarios = new Set(loads.map(({ scenario }) => scenario));
  for (const multiplier of [1, 10, 100]) {
    if (!multipliers.has(multiplier as 1 | 10 | 100)) {
      issues.push(`missing ${multiplier}x anonymous load receipt`);
    }
  }
  for (const scenario of [
    "warm",
    "cache-miss",
    "cold-deploy",
    "missing-object",
  ]) {
    if (!scenarios.has(scenario as AnonymousLoadReceipt["scenario"])) {
      issues.push(`missing ${scenario} load scenario`);
    }
  }
  const comparisonByWindow = new Map(
    comparisons.map((comparison) => [comparison.windowName, comparison]),
  );
  if (comparisonByWindow.size !== comparisons.length) {
    issues.push("duplicate Turso comparison window names");
  }
  const runIds = new Set<string>();
  for (const load of loads) {
    if (runIds.has(load.runId)) issues.push(`load receipt ${load.runId} is duplicated`);
    runIds.add(load.runId);
    if (load.baseOrigin !== "https://news.ax0x.ai") {
      issues.push(`load receipt ${load.runId} is not from the production public origin`);
    }
    const expectedRequests = buildExpectedRequestCount(load);
    if (
      load.plannedRequests !== expectedRequests ||
      load.completedRequests !== load.plannedRequests ||
      load.statusMismatchCount !== 0 ||
      load.unexpected5xxCount !== 0
    ) {
      issues.push(`load receipt ${load.runId} did not complete cleanly`);
    }
    const comparison = comparisonByWindow.get(load.runId);
    if (!comparison?.decoupled) {
      issues.push(`load receipt ${load.runId} lacks zero-delta Turso control`);
    }
  }
  return !issues.some(
    (issue) =>
      issue.startsWith("missing ") ||
      issue.startsWith("load receipt ") ||
      issue.startsWith("duplicate Turso"),
  );
}

function buildExpectedRequestCount(load: AnonymousLoadReceipt): number {
  return buildAnonymousLoadPlan(load.multiplier, load.scenario).length;
}

function readRelative(base: string, path: string): unknown {
  return readJson(resolve(base, path));
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

async function main(argv: readonly string[]): Promise<void> {
  requireApply(argv);
  const verdict = verifyPublicCutoverEvidence(
    requiredFlagValue(argv, "--manifest"),
  );
  writePublicEvidenceReceipt(requiredFlagValue(argv, "--receipt"), verdict);
  console.log(JSON.stringify(verdict, null, 2));
  if (!verdict.ac004 || !verdict.ac011 || !verdict.ac012) process.exitCode = 1;
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
