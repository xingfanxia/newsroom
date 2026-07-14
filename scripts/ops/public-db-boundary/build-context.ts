import type {
  PublicDbBoundaryRule,
  PublicDbBoundaryViolation,
} from "./types";

export interface BuildBoundaryContext {
  readonly appBuildModules: ReadonlyMap<string, string>;
  readonly physicalRootDir: string;
  readonly physicalServerRoot: string;
  readonly rootDir: string;
  readonly selectedAppPaths: ReadonlySet<string>;
  readonly serverRoot: string;
  readonly violations: PublicDbBoundaryViolation[];
  readonly visited: Set<string>;
}

export function addBuildViolation(
  context: BuildBoundaryContext,
  entrypoint: string,
  file: string,
  rule: PublicDbBoundaryRule,
  detail: string,
): void {
  context.violations.push({
    detail,
    entrypoint,
    file,
    importChain: [],
    rule,
  });
}
