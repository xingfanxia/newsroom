export type PublicDbBoundaryRule =
  | "db-owning-loader"
  | "db-source"
  | "drizzle-orm"
  | "invalid-build-module"
  | "invalid-manifest"
  | "invalid-trace"
  | "invalid-trace-dependency"
  | "libsql-client"
  | "malformed-manifest"
  | "malformed-trace"
  | "missing-manifest-entry"
  | "missing-build-module"
  | "missing-manifest"
  | "missing-source"
  | "missing-trace"
  | "missing-trace-dependency"
  | "nonliteral-import"
  | "publisher-source"
  | "turso-secret"
  | "unverified-edge-content"
  | "unresolved-internal-import"
  | "unsafe-manifest-path"
  | "unsafe-source-path"
  | "unsafe-trace-path";

export interface PublicDbBoundaryViolation {
  readonly detail: string;
  readonly entrypoint: string;
  readonly file: string;
  readonly importChain: readonly string[];
  readonly rule: PublicDbBoundaryRule;
}

export interface PublicDbBoundaryReport {
  readonly contaminatedEntrypoints: readonly string[];
  readonly ok: boolean;
  readonly violations: readonly PublicDbBoundaryViolation[];
  readonly visitedFiles: readonly string[];
}

export interface BuiltArtifactScanResult {
  readonly moduleOk: boolean;
  readonly tracePresent: boolean;
}
