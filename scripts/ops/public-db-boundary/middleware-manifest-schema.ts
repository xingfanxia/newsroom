import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { addBuildViolation, type BuildBoundaryContext } from "./build-context";
import { isWithin, toPosix } from "./conventions";

export interface MiddlewareManifest {
  readonly functions: Record<string, unknown>;
  readonly instrumentation?: unknown;
  readonly middleware: Record<string, unknown>;
}

export interface MiddlewareManifestFile {
  readonly manifest: MiddlewareManifest;
  readonly path: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateManifestFile(
  context: BuildBoundaryContext,
  entrypoint: string,
  path: string,
): boolean {
  const file = toPosix(relative(context.rootDir, path));
  context.visited.add(file);
  if (!existsSync(path)) {
    addBuildViolation(context, entrypoint, file, "missing-manifest", "Middleware manifest does not exist");
    return false;
  }
  if (!statSync(path).isFile()) {
    addBuildViolation(context, entrypoint, file, "invalid-manifest", "Middleware manifest is not a regular file");
    return false;
  }
  const physical = realpathSync(path);
  if (
    !isWithin(context.physicalRootDir, physical) ||
    !isWithin(context.physicalServerRoot, physical)
  ) {
    addBuildViolation(context, entrypoint, file, "unsafe-manifest-path", "Middleware manifest physically escapes .next/server");
    return false;
  }
  return true;
}

function parseManifest(
  context: BuildBoundaryContext,
  entrypoint: string,
  path: string,
): MiddlewareManifest | null {
  const file = toPosix(relative(context.rootDir, path));
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    addBuildViolation(context, entrypoint, file, "malformed-manifest", `Invalid middleware manifest JSON: ${detail}`);
    return null;
  }
  const value = parsed as Record<string, unknown> | null;
  const valid =
    isRecord(value) &&
    value.version === 3 &&
    isRecord(value.middleware) &&
    isRecord(value.functions) &&
    Array.isArray(value.sortedMiddleware) &&
    value.sortedMiddleware.every((item) => typeof item === "string");
  if (!valid || !value) {
    addBuildViolation(context, entrypoint, file, "malformed-manifest", "Middleware manifest must be a version 3 manifest");
    return null;
  }
  return {
    functions: value.functions as Record<string, unknown>,
    instrumentation: value.instrumentation,
    middleware: value.middleware as Record<string, unknown>,
  };
}

export function readMiddlewareManifest(
  context: BuildBoundaryContext,
  entrypoint: string,
): MiddlewareManifestFile | null {
  const path = join(context.serverRoot, "middleware-manifest.json");
  if (!validateManifestFile(context, entrypoint, path)) return null;
  const manifest = parseManifest(context, entrypoint, path);
  return manifest ? { manifest, path } : null;
}
