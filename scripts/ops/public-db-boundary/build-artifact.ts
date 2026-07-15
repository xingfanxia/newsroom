import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, win32 } from "node:path";
import { addBuildViolation, type BuildBoundaryContext } from "./build-context";
import { isWithin, toPosix } from "./conventions";
import { buildRuleForPath } from "./rules";
import type { BuiltArtifactScanResult, PublicDbBoundaryRule } from "./types";

export interface BuiltArtifactOptions {
  readonly allowedModuleRoot: string;
  readonly allowedTraceRoot: string;
  readonly buildModulePath: string;
  readonly entrypoint: string;
  readonly traceRequired: boolean;
}

interface TraceEvidence {
  readonly files: readonly string[];
  readonly present: boolean;
}

function validateBuildModule(
  context: BuildBoundaryContext,
  options: BuiltArtifactOptions,
): boolean {
  const file = toPosix(relative(context.rootDir, options.buildModulePath));
  if (
    !isWithin(context.rootDir, options.buildModulePath) ||
    !isWithin(options.allowedModuleRoot, options.buildModulePath)
  ) {
    addBuildViolation(context, options.entrypoint, file, "unsafe-manifest-path", "Compiled Next build module escapes its allowed output root");
    return false;
  }
  if (!existsSync(options.buildModulePath)) {
    addBuildViolation(context, options.entrypoint, file, "missing-build-module", "Compiled Next build module is missing");
    return false;
  }
  if (!statSync(options.buildModulePath).isFile()) {
    addBuildViolation(context, options.entrypoint, file, "invalid-build-module", "Compiled Next build module is not a regular file");
    return false;
  }
  const physicalModule = realpathSync(options.buildModulePath);
  const physicalAllowedRoot = realpathSync(options.allowedModuleRoot);
  if (
    !isWithin(context.physicalRootDir, physicalModule) ||
    !isWithin(context.physicalServerRoot, physicalModule) ||
    !isWithin(physicalAllowedRoot, physicalModule)
  ) {
    addBuildViolation(context, options.entrypoint, file, "unsafe-manifest-path", "Compiled Next build module physically escapes its allowed output root");
    return false;
  }
  return true;
}

function validateTracePath(
  context: BuildBoundaryContext,
  options: BuiltArtifactOptions,
  tracePath: string,
): boolean | null {
  const file = toPosix(relative(context.rootDir, tracePath));
  context.visited.add(file);
  if (!existsSync(tracePath)) {
    if (options.traceRequired) {
      addBuildViolation(context, options.entrypoint, file, "missing-trace", "Next output trace is missing");
    }
    return null;
  }
  if (!statSync(tracePath).isFile()) {
    addBuildViolation(context, options.entrypoint, file, "invalid-trace", "Next output trace is not a regular file");
    return false;
  }
  const physicalTrace = realpathSync(tracePath);
  const physicalAllowedRoot = realpathSync(options.allowedTraceRoot);
  if (
    !isWithin(context.physicalRootDir, physicalTrace) ||
    !isWithin(context.physicalServerRoot, physicalTrace) ||
    !isWithin(physicalAllowedRoot, physicalTrace)
  ) {
    addBuildViolation(context, options.entrypoint, file, "unsafe-trace-path", "Next output trace physically escapes its allowed output root");
    return false;
  }
  return true;
}

function parseTraceFiles(
  context: BuildBoundaryContext,
  entrypoint: string,
  tracePath: string,
): readonly string[] | null {
  const file = toPosix(relative(context.rootDir, tracePath));
  let trace: unknown;
  try {
    trace = JSON.parse(readFileSync(tracePath, "utf8"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    addBuildViolation(context, entrypoint, file, "malformed-trace", `Invalid JSON: ${detail}`);
    return null;
  }
  const value = trace as { files?: unknown; version?: unknown } | null;
  if (
    !value ||
    value.version !== 1 ||
    !Array.isArray(value.files) ||
    !value.files.every((dependency) => typeof dependency === "string")
  ) {
    addBuildViolation(context, entrypoint, file, "malformed-trace", "Next output trace must have version 1 and string files[]");
    return null;
  }
  return value.files as string[];
}

function readTrace(
  context: BuildBoundaryContext,
  options: BuiltArtifactOptions,
): TraceEvidence {
  const tracePath = `${options.buildModulePath}.nft.json`;
  const validity = validateTracePath(context, options, tracePath);
  if (validity === null) return { files: [], present: false };
  if (!validity) return { files: [], present: true };
  const files = parseTraceFiles(context, options.entrypoint, tracePath);
  if (files) scanTraceDependencies(context, options.entrypoint, tracePath, files);
  return { files: files ?? [], present: true };
}

function unsafeTraceDependency(file: string): boolean {
  const normalized = file.replaceAll("\\", "/");
  return isAbsolute(file) || win32.isAbsolute(file) || /^[A-Za-z]:/.test(normalized);
}

function validateDependencyPath(
  context: BuildBoundaryContext,
  entrypoint: string,
  tracePath: string,
  file: string,
): string | null {
  if (unsafeTraceDependency(file)) {
    addBuildViolation(context, entrypoint, file, "unsafe-trace-path", `Trace dependency is absolute: ${file}`);
    return null;
  }
  const resolvedFile = resolve(dirname(tracePath), file.replaceAll("\\", "/"));
  if (!isWithin(context.rootDir, resolvedFile)) {
    addBuildViolation(context, entrypoint, file, "unsafe-trace-path", `Trace dependency escapes repository root: ${file}`);
    return null;
  }
  if (!existsSync(resolvedFile)) {
    addBuildViolation(context, entrypoint, file, "missing-trace-dependency", `Trace dependency does not exist: ${file}`);
    return null;
  }
  const physicalFile = realpathSync(resolvedFile);
  if (!isWithin(context.physicalRootDir, physicalFile)) {
    addBuildViolation(context, entrypoint, file, "unsafe-trace-path", `Trace dependency physically escapes repository root: ${file}`);
    return null;
  }
  return resolvedFile;
}

function dependencyRule(
  context: BuildBoundaryContext,
  entrypoint: string,
  file: string,
  resolvedFile: string,
): PublicDbBoundaryRule | null {
  const physicalFile = realpathSync(resolvedFile);
  const rule = buildRuleForPath(
    file.replaceAll("\\", "/"),
    toPosix(relative(context.physicalRootDir, physicalFile)),
  );
  if (!statSync(resolvedFile).isFile() && !rule) {
    addBuildViolation(context, entrypoint, file, "invalid-trace-dependency", `Trace dependency is not a regular file: ${file}`);
    return null;
  }
  return rule;
}

function scanTraceDependencies(
  context: BuildBoundaryContext,
  entrypoint: string,
  tracePath: string,
  files: readonly string[],
): void {
  const seenRules = new Set<PublicDbBoundaryRule>();
  for (const file of files) {
    const resolvedFile = validateDependencyPath(context, entrypoint, tracePath, file);
    if (!resolvedFile) continue;
    const rule = dependencyRule(context, entrypoint, file, resolvedFile);
    if (rule && !seenRules.has(rule)) {
      seenRules.add(rule);
      addBuildViolation(context, entrypoint, file, rule, `Forbidden built dependency ${file}`);
    }
  }
}

export function scanBuiltArtifact(
  context: BuildBoundaryContext,
  options: BuiltArtifactOptions,
): BuiltArtifactScanResult {
  if (!validateBuildModule(context, options)) {
    return { moduleOk: false, tracePresent: false };
  }
  const trace = readTrace(context, options);
  return { moduleOk: true, tracePresent: trace.present };
}
