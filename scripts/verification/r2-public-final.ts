import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runHermeticVerify } from "./run-hermetic-verify";
import {
  verifyR2PublicCriterion,
  type CriterionReceipt,
} from "./r2-public-criteria";

export const FINAL_R2_PUBLIC_CRITERIA = [
  "AC-001",
  "AC-002",
  "AC-003",
  "AC-004",
  "AC-005",
  "AC-006",
  "AC-007",
  "AC-008",
  "AC-009",
  "AC-010",
  "AC-011",
  "AC-012",
  "AC-013",
] as const;

export interface FinalVerificationResult {
  ok: true;
  repositoryGate: string;
  criteria: readonly CriterionReceipt[];
}

interface FinalVerificationDependencies {
  runRepositoryGate?: (root: string) => Promise<string>;
  verifyCriterion?: (
    criterion: (typeof FINAL_R2_PUBLIC_CRITERIA)[number],
    root: string,
  ) => Promise<CriterionReceipt>;
}

async function runRepositoryGate(root: string): Promise<string> {
  const exitCode = await runHermeticVerify({ root, inheritedEnv: process.env });
  if (exitCode !== 0) throw new Error("hermetic repository gate failed");
  return "hermetic typecheck/lint/build/dead-code/test gate passed";
}

export async function verifyR2PublicFinal(
  root = resolve(join(import.meta.dir, "../..")),
  dependencies: FinalVerificationDependencies = {},
): Promise<FinalVerificationResult> {
  const repositoryGate = await (
    dependencies.runRepositoryGate ?? runRepositoryGate
  )(root);
  const verifyCriterion =
    dependencies.verifyCriterion ??
    ((criterion: (typeof FINAL_R2_PUBLIC_CRITERIA)[number], targetRoot: string) =>
      verifyR2PublicCriterion(criterion, targetRoot));
  const criteria: CriterionReceipt[] = [];
  for (const criterion of FINAL_R2_PUBLIC_CRITERIA) {
    const result = await verifyCriterion(criterion, root);
    if (!result.ok || result.criterion !== criterion) {
      throw new Error(`${criterion} returned an invalid final-verification receipt`);
    }
    criteria.push(result);
  }
  return { ok: true, repositoryGate, criteria };
}

export function renderFinalVerificationReport(
  result: FinalVerificationResult,
  options: { goalVersion: string; verifiedAt?: string },
): string {
  const verifiedAt = options.verifiedAt ?? new Date().toISOString();
  const rows = result.criteria.map(
    ({ criterion, receipts }) =>
      `| ${criterion} | PASS | ${receipts.map(markdownCell).join("<br>")} |`,
  );
  return [
    "# R2 Public-Read Final Verification",
    "",
    `Goal version: \`${options.goalVersion}\``,
    "",
    `Verified at: \`${verifiedAt}\``,
    "",
    "Status: **PASS**",
    "",
    `Repository gate: ${result.repositoryGate}`,
    "",
    "| Criterion | Status | Evidence |",
    "|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}

export function writeFinalVerificationReport(
  root: string,
  report: string,
): string {
  const path = resolve(root, "loop/VERIFY.md");
  writeFileSync(path, report, "utf8");
  return path;
}

function markdownCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll(/\r?\n/g, " ");
}
