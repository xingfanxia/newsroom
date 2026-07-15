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
import {
  buildAnonymousLoadPlan,
  type AnonymousLoadRequest,
  type AnonymousLoadScenario,
} from "@/scripts/verification/public-runtime-corpus";

const scenarios = [
  "warm",
  "cache-miss",
  "cold-deploy",
  "missing-object",
] as const;

export const anonymousLoadReceiptSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("anonymous-load"),
  runId: z.string().min(1),
  scenario: z.enum(scenarios),
  multiplier: z.union([z.literal(1), z.literal(10), z.literal(100)]),
  baseOrigin: z.string().url(),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime(),
  plannedRequests: z.number().int().nonnegative(),
  completedRequests: z.number().int().nonnegative(),
  receivedBytes: z.number().int().nonnegative(),
  statusMismatchCount: z.number().int().nonnegative(),
  unexpected5xxCount: z.number().int().nonnegative(),
  mismatches: z.array(
    z.strictObject({
      expected: z.number().int(),
      method: z.enum(["GET", "HEAD", "RSC"]),
      path: z.string(),
      received: z.number().int(),
      session: z.number().int().positive(),
    }),
  ),
});

export type AnonymousLoadReceipt = z.infer<typeof anonymousLoadReceiptSchema>;

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export async function runAnonymousLoad(options: {
  readonly baseUrl: string;
  readonly concurrency?: number;
  readonly fetch?: FetchLike;
  readonly ledger: PublicSpendLedger;
  readonly multiplier: 1 | 10 | 100;
  readonly now?: () => number;
  readonly scenario: AnonymousLoadScenario;
}): Promise<AnonymousLoadReceipt> {
  const baseUrl = new URL(options.baseUrl);
  baseUrl.pathname = "/";
  baseUrl.search = "";
  baseUrl.hash = "";
  assertExplicitIntegrationOptIn(baseUrl.toString());
  const plan = buildAnonymousLoadPlan(options.multiplier, options.scenario);
  assertPublicSpendReservation(options.ledger, {
    bootstrapSnapshots: 0,
    publicHttpRequests: plan.length,
    r2ObjectWrites: 0,
    transferBytes: options.ledger.planned.transferBytes,
  });
  const concurrency = options.concurrency ?? 16;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 64) {
    throw new Error("load concurrency must be an integer from 1 to 64");
  }
  const request = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const startedAt = now();
  let cursor = 0;
  let completedRequests = 0;
  let receivedBytes = 0;
  let unexpected5xxCount = 0;
  let statusMismatchCount = 0;
  const mismatches: AnonymousLoadReceipt["mismatches"] = [];

  const worker = async () => {
    while (cursor < plan.length) {
      const item = plan[cursor++] as AnonymousLoadRequest;
      const url = new URL(item.path, baseUrl);
      const response = await request(url, {
        method: item.method === "HEAD" ? "HEAD" : "GET",
        redirect: "manual",
        headers:
          item.method === "RSC"
            ? { RSC: "1", "Next-Router-Prefetch": "1" }
            : undefined,
      });
      let bytes = 0;
      if (item.method !== "HEAD") {
        bytes = (await response.arrayBuffer()).byteLength;
      }
      receivedBytes += bytes;
      completedRequests += 1;
      if (receivedBytes > options.ledger.planned.transferBytes) {
        throw new Error("spend ledger transferBytes reservation exceeded");
      }
      if (response.status !== item.expectedStatus) {
        statusMismatchCount += 1;
        if (mismatches.length < 100) {
          mismatches.push({
            expected: item.expectedStatus,
            method: item.method,
            path: item.path,
            received: response.status,
            session: item.session,
          });
        }
        if (response.status >= 500 && item.expectedStatus < 500) {
          unexpected5xxCount += 1;
        }
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, plan.length) }, worker),
  );
  return anonymousLoadReceiptSchema.parse({
    schemaVersion: 1,
    kind: "anonymous-load",
    runId: options.ledger.runId,
    scenario: options.scenario,
    multiplier: options.multiplier,
    baseOrigin: baseUrl.origin,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date(now()).toISOString(),
    plannedRequests: plan.length,
    completedRequests,
    receivedBytes,
    statusMismatchCount,
    unexpected5xxCount,
    mismatches,
  });
}

function parseScenario(value: string): AnonymousLoadScenario {
  if (!(scenarios as readonly string[]).includes(value)) {
    throw new Error("--scenario must be warm, cache-miss, cold-deploy or missing-object");
  }
  return value as AnonymousLoadScenario;
}

async function main(argv: readonly string[]): Promise<void> {
  requireApply(argv);
  const multiplier = Number(requiredFlagValue(argv, "--multiplier"));
  if (![1, 10, 100].includes(multiplier)) {
    throw new Error("--multiplier must be 1, 10 or 100");
  }
  const ledger = readPublicSpendLedger(
    requiredFlagValue(argv, "--spend-ledger"),
  );
  const receipt = await runAnonymousLoad({
    baseUrl: requiredFlagValue(argv, "--base-url"),
    concurrency: Number(argv.includes("--concurrency")
      ? requiredFlagValue(argv, "--concurrency")
      : 16),
    ledger,
    multiplier: multiplier as 1 | 10 | 100,
    scenario: parseScenario(requiredFlagValue(argv, "--scenario")),
  });
  writePublicEvidenceReceipt(requiredFlagValue(argv, "--receipt"), receipt);
  console.log(JSON.stringify(receipt, null, 2));
  if (receipt.statusMismatchCount > 0 || receipt.unexpected5xxCount > 0) {
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
