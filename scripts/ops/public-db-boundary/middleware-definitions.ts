import { addBuildViolation, type BuildBoundaryContext } from "./build-context";
import { TURSO_SECRET } from "./conventions";
import type { ArtifactValidator } from "./middleware-artifacts";
import { isRecord } from "./middleware-manifest-schema";

export interface DefinitionEvidence {
  readonly entrypoint: string | null;
  readonly files: readonly string[];
  readonly valid: boolean;
}

function malformedDefinition(
  context: BuildBoundaryContext,
  entrypoint: string,
  manifestFile: string,
  kind: string,
  page: string,
): null {
  addBuildViolation(context, entrypoint, manifestFile, "malformed-manifest", `Invalid ${kind} definition for ${page}`);
  return null;
}

function assetPaths(
  context: BuildBoundaryContext,
  entrypoint: string,
  manifestFile: string,
  kind: string,
  page: string,
  fields: readonly unknown[],
): string[] | null {
  const paths: string[] = [];
  for (const field of fields) {
    if (field === undefined) continue;
    if (
      !Array.isArray(field) ||
      !field.every((binding) => isRecord(binding) && typeof binding.filePath === "string")
    ) {
      addBuildViolation(context, entrypoint, manifestFile, "malformed-manifest", `Invalid ${kind} asset bindings for ${page}`);
      return null;
    }
    paths.push(...field.map((binding) => binding.filePath as string));
  }
  return paths;
}

function definitionParts(
  context: BuildBoundaryContext,
  entrypoint: string,
  manifestFile: string,
  kind: string,
  page: string,
  definition: unknown,
): { entrypoint: string; env: Record<string, unknown> | null; files: string[] } | null {
  if (!isRecord(definition)) return malformedDefinition(context, entrypoint, manifestFile, kind, page);
  if (
    typeof definition.entrypoint !== "string" ||
    definition.page !== page ||
    !Array.isArray(definition.files) ||
    !definition.files.every((file) => typeof file === "string") ||
    (definition.env !== undefined && !isRecord(definition.env))
  ) {
    return malformedDefinition(context, entrypoint, manifestFile, kind, page);
  }
  const assets = assetPaths(context, entrypoint, manifestFile, kind, page, [definition.wasm, definition.assets]);
  if (!assets) return null;
  return {
    entrypoint: definition.entrypoint,
    env: (definition.env as Record<string, unknown> | undefined) ?? null,
    files: [...definition.files as string[], ...assets],
  };
}

function scanEnvironment(
  context: BuildBoundaryContext,
  owner: string,
  manifestFile: string,
  kind: string,
  env: Record<string, unknown> | null,
): void {
  const key = env ? Object.keys(env).find((name) => TURSO_SECRET.test(name)) : null;
  if (key) {
    addBuildViolation(context, owner, manifestFile, "turso-secret", `Forbidden Turso environment key in ${kind} definition: ${key}`);
  }
}

export function validateDefinition(
  context: BuildBoundaryContext,
  validateArtifact: ArtifactValidator,
  manifestFile: string,
  globalOwner: string,
  kind: "functions" | "middleware",
  page: string,
  definition: unknown,
): DefinitionEvidence {
  const parts = definitionParts(context, globalOwner, manifestFile, kind, page, definition);
  if (!parts) return { entrypoint: null, files: [], valid: false };
  const enforceForbidden = kind === "middleware" || context.selectedAppPaths.has(page);
  const owner = kind === "middleware" ? globalOwner : page;
  if (enforceForbidden) scanEnvironment(context, owner, manifestFile, kind, parts.env);
  let valid = true;
  for (const file of new Set([parts.entrypoint, ...parts.files])) {
    if (!validateArtifact(owner, file, enforceForbidden)) valid = false;
  }
  return { entrypoint: parts.entrypoint, files: parts.files, valid };
}

export function validateInstrumentation(
  context: BuildBoundaryContext,
  validateArtifact: ArtifactValidator,
  manifestFile: string,
  entrypoint: string,
  instrumentation: unknown,
): boolean {
  if (instrumentation === undefined) return false;
  if (
    !isRecord(instrumentation) ||
    !Array.isArray(instrumentation.files) ||
    !instrumentation.files.every((file) => typeof file === "string")
  ) {
    addBuildViolation(context, entrypoint, manifestFile, "malformed-manifest", "Invalid middleware instrumentation artifact list");
    return false;
  }
  let valid = true;
  for (const file of instrumentation.files as string[]) {
    if (!validateArtifact(entrypoint, file, true)) valid = false;
  }
  return valid;
}
