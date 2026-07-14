import { existsSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, normalize, relative, resolve, win32 } from "node:path";
import { addBuildViolation, type BuildBoundaryContext } from "./build-context";
import { isWithin, toPosix } from "./conventions";
import { buildRuleForPath } from "./rules";

export type ArtifactValidator = (
  owner: string,
  file: string,
  enforceForbidden: boolean,
) => boolean;

function artifactPathFailure(
  context: BuildBoundaryContext,
  owner: string,
  file: string,
  normalizedFile: string,
  path: string,
): boolean {
  const distRoot = join(context.rootDir, ".next");
  if (
    isAbsolute(file) ||
    win32.isAbsolute(file) ||
    /^[A-Za-z]:/.test(normalizedFile) ||
    normalizedFile === ".." ||
    normalizedFile.startsWith("../") ||
    !isWithin(distRoot, path)
  ) {
    addBuildViolation(context, owner, file, "unsafe-manifest-path", `Middleware manifest artifact escapes .next: ${file}`);
    return true;
  }
  return false;
}

function artifactShapeFailure(
  context: BuildBoundaryContext,
  owner: string,
  file: string,
  relativePath: string,
  path: string,
): boolean {
  if (!existsSync(path)) {
    addBuildViolation(context, owner, relativePath, "missing-build-module", `Middleware manifest artifact is missing: ${file}`);
    return true;
  }
  if (!statSync(path).isFile()) {
    addBuildViolation(context, owner, relativePath, "invalid-build-module", `Middleware manifest artifact is not a regular file: ${file}`);
    return true;
  }
  return false;
}

function physicalArtifactFailure(
  context: BuildBoundaryContext,
  owner: string,
  file: string,
  relativePath: string,
  path: string,
): boolean {
  const physical = realpathSync(path);
  const physicalDistRoot = realpathSync(join(context.rootDir, ".next"));
  if (
    !isWithin(context.physicalRootDir, physical) ||
    !isWithin(physicalDistRoot, physical)
  ) {
    addBuildViolation(context, owner, relativePath, "unsafe-manifest-path", `Middleware manifest artifact physically escapes .next: ${file}`);
    return true;
  }
  return false;
}

function artifactFailure(
  context: BuildBoundaryContext,
  owner: string,
  file: string,
  normalizedFile: string,
  path: string,
): boolean {
  const relativePath = toPosix(relative(context.rootDir, path));
  return (
    artifactPathFailure(context, owner, file, normalizedFile, path) ||
    artifactShapeFailure(context, owner, file, relativePath, path) ||
    physicalArtifactFailure(context, owner, file, relativePath, path)
  );
}

function scanForbiddenArtifact(
  context: BuildBoundaryContext,
  owner: string,
  file: string,
  normalizedFile: string,
  path: string,
): void {
  const physical = realpathSync(path);
  const rule = buildRuleForPath(
    normalizedFile,
    toPosix(relative(context.physicalRootDir, physical)),
  );
  if (rule) {
    addBuildViolation(context, owner, toPosix(relative(context.rootDir, path)), rule, `Forbidden middleware manifest artifact ${file}`);
  }
}

export function createArtifactValidator(
  context: BuildBoundaryContext,
): ArtifactValidator {
  const cache = new Map<string, boolean>();
  const distRoot = join(context.rootDir, ".next");
  return (owner, file, enforceForbidden) => {
    const normalizedFile = toPosix(normalize(file.replaceAll("\\", "/")));
    const path = resolve(distRoot, normalizedFile);
    const key = `${owner}\0${normalizedFile}\0${enforceForbidden}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    if (artifactFailure(context, owner, file, normalizedFile, path)) {
      cache.set(key, false);
      return false;
    }
    if (enforceForbidden) scanForbiddenArtifact(context, owner, file, normalizedFile, path);
    context.visited.add(toPosix(relative(context.rootDir, path)));
    cache.set(key, true);
    return true;
  };
}
