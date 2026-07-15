import { extname } from "node:path";
import { TURSO_SECRET } from "./conventions";
import { buildRuleForPath, rulesForSource } from "./rules";
import type { SourceFileEvidence } from "./source-types";
import type { PublicDbBoundaryRule } from "./types";

export interface SourceRuleFinding {
  readonly detail: string;
  readonly file: string;
  readonly rule: PublicDbBoundaryRule;
}

export function sourceRuleFindings(
  evidence: SourceFileEvidence,
): SourceRuleFinding[] {
  const findings: SourceRuleFinding[] = [];
  for (const file of new Set([
    evidence.relativePath,
    evidence.physicalRelativePath,
  ])) {
    const rules = new Set(rulesForSource(file));
    const packageRule = buildRuleForPath(file, file);
    if (packageRule) rules.add(packageRule);
    for (const rule of rules) {
      findings.push({ detail: `Forbidden ${rule} reached`, file, rule });
    }
  }
  if (extname(evidence.absolutePath) === ".json" && TURSO_SECRET.test(evidence.source)) {
    findings.push({
      detail: "Forbidden turso-secret reached in JSON runtime data",
      file: evidence.relativePath,
      rule: "turso-secret",
    });
  }
  return findings;
}
