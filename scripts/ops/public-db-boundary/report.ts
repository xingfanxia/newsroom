import type {
  PublicDbBoundaryReport,
  PublicDbBoundaryViolation,
} from "./types";

export function boundaryReport(
  violations: readonly PublicDbBoundaryViolation[],
  visitedFiles: Iterable<string>,
): PublicDbBoundaryReport {
  const sortedViolations = [...violations].sort(
    (left, right) =>
      left.entrypoint.localeCompare(right.entrypoint) ||
      left.importChain.join("\0").localeCompare(right.importChain.join("\0")) ||
      left.rule.localeCompare(right.rule),
  );
  return {
    contaminatedEntrypoints: [
      ...new Set(sortedViolations.map((item) => item.entrypoint)),
    ].sort(),
    ok: sortedViolations.length === 0,
    violations: sortedViolations,
    visitedFiles: [...new Set(visitedFiles)].sort(),
  };
}
