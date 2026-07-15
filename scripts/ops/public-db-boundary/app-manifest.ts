import { existsSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, win32 } from "node:path";
import {
  readAppPathsManifest,
  type AppPathsManifest,
} from "@/scripts/verification/discover-public-entrypoints";
import type { BuildBoundaryContext } from "./build-context";
import { isWithin, toPosix } from "./conventions";
import { boundaryReport } from "./report";
import type { PublicDbBoundaryReport, PublicDbBoundaryRule } from "./types";

export interface PreparedBuildBoundary {
  readonly appBuildRoot: string;
  readonly appPaths: readonly string[];
  readonly context: BuildBoundaryContext;
  readonly manifest: AppPathsManifest;
}

export type BuildBoundaryPreparation =
  | { readonly prepared: PreparedBuildBoundary; readonly report?: never }
  | { readonly prepared?: never; readonly report: PublicDbBoundaryReport };

function manifestFailure(
  file: string,
  rule: PublicDbBoundaryRule,
  detail: string,
): PublicDbBoundaryReport {
  return boundaryReport(
    [{ detail, entrypoint: "<manifest>", file, importChain: [], rule }],
    [],
  );
}

function validateManifestPath(
  rootDir: string,
  serverRoot: string,
  manifestPath: string,
): PublicDbBoundaryReport | null {
  const file = toPosix(relative(rootDir, manifestPath));
  if (
    isAbsolute(file) ||
    win32.isAbsolute(file) ||
    !isWithin(rootDir, manifestPath) ||
    !isWithin(serverRoot, manifestPath)
  ) {
    return manifestFailure(file, "unsafe-manifest-path", "App paths manifest escapes .next/server");
  }
  if (!existsSync(manifestPath)) {
    return manifestFailure(file, "missing-manifest", "App paths manifest does not exist");
  }
  if (!statSync(manifestPath).isFile()) {
    return manifestFailure(file, "invalid-manifest", "App paths manifest is not a regular file");
  }
  const physicalRoot = realpathSync(rootDir);
  const physicalServer = realpathSync(serverRoot);
  const physicalManifest = realpathSync(manifestPath);
  if (
    !isWithin(physicalRoot, physicalManifest) ||
    !isWithin(physicalServer, physicalManifest)
  ) {
    return manifestFailure(file, "unsafe-manifest-path", "App paths manifest physically escapes .next/server");
  }
  return null;
}

function parseManifest(
  rootDir: string,
  manifestPath: string,
):
  | { readonly manifest: AppPathsManifest; readonly report?: never }
  | { readonly manifest?: never; readonly report: PublicDbBoundaryReport } {
  try {
    return { manifest: readAppPathsManifest(manifestPath) };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      report: manifestFailure(
        toPosix(relative(rootDir, manifestPath)),
        "malformed-manifest",
        detail,
      ),
    };
  }
}

export function prepareBuildBoundary(options: {
  readonly appPaths?: readonly string[];
  readonly manifestPath?: string;
  readonly rootDir: string;
}): BuildBoundaryPreparation {
  const rootDir = resolve(options.rootDir);
  const serverRoot = join(rootDir, ".next/server");
  const manifestPath = resolve(
    rootDir,
    options.manifestPath ?? join(serverRoot, "app-paths-manifest.json"),
  );
  const failure = validateManifestPath(rootDir, serverRoot, manifestPath);
  if (failure) return { report: failure };
  const parsed = parseManifest(rootDir, manifestPath);
  if (parsed.report) return { report: parsed.report };
  const manifest = parsed.manifest;
  const appPaths = [...(options.appPaths ?? Object.keys(manifest))].sort();
  const context: BuildBoundaryContext = {
    appBuildModules: new Map(Object.entries(manifest)),
    physicalRootDir: realpathSync(rootDir),
    physicalServerRoot: realpathSync(serverRoot),
    rootDir,
    selectedAppPaths: new Set(appPaths),
    serverRoot,
    violations: [],
    visited: new Set(),
  };
  return {
    prepared: {
      appBuildRoot: join(serverRoot, "app"),
      appPaths,
      context,
      manifest,
    },
  };
}
