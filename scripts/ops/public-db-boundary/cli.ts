import {
  ANONYMOUS_SERVING_ENTRYPOINTS,
  SNAPSHOT_ONLY_ENTRYPOINTS,
  type PublicServingEntrypoint,
} from "@/lib/public-content/entrypoints";
import { checkBuiltPublicDbBoundary } from "./build-boundary";
import { checkSourcePublicDbBoundary } from "./source-boundary";
import type { PublicDbBoundaryReport } from "./types";

function printReport(
  label: string,
  report: PublicDbBoundaryReport,
  summaryOnly: boolean,
): void {
  const grouped = Object.groupBy(report.violations, (violation) => violation.rule);
  const byRule = Object.fromEntries(
    Object.entries(grouped)
      .map(([rule, violations]) => [rule, violations.length] as const)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  console.log(
    JSON.stringify(
      summaryOnly
        ? {
            byRule,
            contaminatedEntrypoints: report.contaminatedEntrypoints.length,
            label,
            ok: report.ok,
            visitedFiles: report.visitedFiles.length,
          }
        : {
            byRule,
            contaminatedEntrypoints: report.contaminatedEntrypoints,
            label,
            ok: report.ok,
            violations: report.violations,
            visitedFiles: report.visitedFiles.length,
          },
      null,
      2,
    ),
  );
}

function sourcePaths(targets: readonly PublicServingEntrypoint[]): string[] {
  return targets
    .map((entrypoint) => entrypoint.sourcePath)
    .filter((path): path is string => path !== null);
}

export function runPublicDbBoundaryCli(): void {
  const rootDir = process.cwd();
  const argumentsSet = new Set(Bun.argv.slice(2));
  const targets = argumentsSet.has("--snapshot-only")
    ? SNAPSHOT_ONLY_ENTRYPOINTS
    : ANONYMOUS_SERVING_ENTRYPOINTS;
  const runSource = !argumentsSet.has("--build") || argumentsSet.has("--source");
  const runBuild = !argumentsSet.has("--source") || argumentsSet.has("--build");
  const summaryOnly = argumentsSet.has("--summary");
  const reports: PublicDbBoundaryReport[] = [];
  if (runSource) {
    const report = checkSourcePublicDbBoundary({
      entrypointSources: sourcePaths(targets),
      rootDir,
    });
    reports.push(report);
    printReport("source", report, summaryOnly);
  }
  if (runBuild) {
    const report = checkBuiltPublicDbBoundary({
      appPaths: targets.map((entrypoint) => entrypoint.appPath),
      rootDir,
    });
    reports.push(report);
    printReport("build", report, summaryOnly);
  }
  if (reports.some((report) => !report.ok)) process.exitCode = 1;
}
