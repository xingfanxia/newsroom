import { existsSync } from "node:fs";
import { isAbsolute, join, normalize, relative, resolve, win32 } from "node:path";
import { globalConventionSources, isWithin, toPosix } from "./conventions";
import { addBuildViolation, type BuildBoundaryContext } from "./build-context";
import { prepareBuildBoundary, type PreparedBuildBoundary } from "./app-manifest";
import { scanBuiltArtifact } from "./build-artifact";
import {
  checkMiddlewareManifest,
  type MiddlewareManifestEvidence,
} from "./middleware-manifest";
import { boundaryReport } from "./report";
import type { PublicDbBoundaryReport } from "./types";

function unsafeBuildModule(buildModule: string, normalized: string): boolean {
  return (
    isAbsolute(buildModule) ||
    win32.isAbsolute(buildModule) ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    !normalized.startsWith("app/") ||
    !normalized.endsWith(".js")
  );
}

function scanAppPath(
  prepared: PreparedBuildBoundary,
  appPath: string,
  edgeFunctionAppPaths: ReadonlySet<string>,
): void {
  const { appBuildRoot, context, manifest } = prepared;
  const buildModule = manifest[appPath];
  if (!buildModule) {
    addBuildViolation(context, appPath, "app-paths-manifest.json", "missing-manifest-entry", "App path is absent from app-paths-manifest.json");
    return;
  }
  const normalized = toPosix(normalize(buildModule.replaceAll("\\", "/")));
  if (unsafeBuildModule(buildModule, normalized)) {
    addBuildViolation(context, appPath, buildModule, "unsafe-manifest-path", `Unsafe build module ${buildModule}`);
    return;
  }
  const buildModulePath = resolve(context.serverRoot, normalized);
  if (!isWithin(appBuildRoot, buildModulePath)) {
    addBuildViolation(context, appPath, toPosix(`${buildModulePath}.nft.json`), "unsafe-manifest-path", "Trace path escapes .next/server");
    return;
  }
  const edgeFunction = edgeFunctionAppPaths.has(appPath);
  const artifact = scanBuiltArtifact(context, {
    allowedModuleRoot: appBuildRoot,
    allowedTraceRoot: appBuildRoot,
    buildModulePath,
    entrypoint: appPath,
    traceRequired: !edgeFunction,
  });
  if (edgeFunction && artifact.moduleOk) {
    addBuildViolation(context, appPath, toPosix(relative(context.rootDir, buildModulePath)), "unverified-edge-content", "Task 4 cannot prove compiled content for an Edge function");
  }
}

function conventionGroups(rootDir: string): {
  readonly instrumentation: readonly string[];
  readonly request: readonly string[];
} {
  const globals = globalConventionSources(rootDir).map((source) =>
    toPosix(relative(rootDir, source)),
  );
  return {
    instrumentation: globals.filter((path) =>
      /(?:^|\/)instrumentation\.(?:js|jsx|ts|tsx)$/.test(path),
    ),
    request: globals.filter((path) =>
      /(?:^|\/)(?:proxy|middleware)\.(?:js|jsx|ts|tsx)$/.test(path),
    ),
  };
}

function scanRequestGlobal(
  context: BuildBoundaryContext,
  owner: string,
  edgeMiddlewareEvidence: boolean,
): void {
  const artifact = scanBuiltArtifact(context, {
    allowedModuleRoot: context.serverRoot,
    allowedTraceRoot: context.serverRoot,
    buildModulePath: join(context.serverRoot, "middleware.js"),
    entrypoint: owner,
    traceRequired: false,
  });
  if (artifact.moduleOk && !artifact.tracePresent && !edgeMiddlewareEvidence) {
    addBuildViolation(context, owner, ".next/server/middleware.js.nft.json", "missing-trace", "Middleware has neither an NFT trace nor valid Edge manifest evidence");
  }
  if (artifact.moduleOk && edgeMiddlewareEvidence) {
    addBuildViolation(context, owner, ".next/server/middleware.js", "unverified-edge-content", "Task 4 cannot prove compiled content for Edge middleware");
  }
}

function scanInstrumentationGlobal(
  context: BuildBoundaryContext,
  owner: string,
  edgeEvidence: boolean,
): void {
  const buildModulePath = join(context.serverRoot, "instrumentation.js");
  if (!existsSync(buildModulePath) && edgeEvidence) {
    addBuildViolation(context, owner, ".next/server/middleware-manifest.json", "unverified-edge-content", "Task 4 cannot prove compiled content for Edge instrumentation");
    return;
  }
  const artifact = scanBuiltArtifact(context, {
    allowedModuleRoot: context.serverRoot,
    allowedTraceRoot: context.serverRoot,
    buildModulePath,
    entrypoint: owner,
    traceRequired: !edgeEvidence,
  });
  if (edgeEvidence && artifact.moduleOk) {
    addBuildViolation(context, owner, ".next/server/instrumentation.js", "unverified-edge-content", "Task 4 cannot prove compiled content for Edge instrumentation");
  }
}

function scanGlobalBuildArtifacts(
  context: BuildBoundaryContext,
): MiddlewareManifestEvidence {
  const groups = conventionGroups(context.rootDir);
  const manifestOwner =
    groups.request[0] ?? groups.instrumentation[0] ?? "<middleware-manifest>";
  const evidence = checkMiddlewareManifest(context, manifestOwner);
  const { edgeMiddlewareEvidence } = evidence;
  if (groups.request[0]) {
    scanRequestGlobal(context, groups.request[0], edgeMiddlewareEvidence);
  } else if (edgeMiddlewareEvidence) {
    addBuildViolation(context, manifestOwner, ".next/server/middleware-manifest.json", "unverified-edge-content", "Task 4 cannot prove compiled content for Edge middleware");
  }
  if (groups.instrumentation[0]) {
    scanInstrumentationGlobal(
      context,
      groups.instrumentation[0],
      evidence.edgeInstrumentationEvidence,
    );
  } else if (evidence.edgeInstrumentationEvidence) {
    addBuildViolation(context, manifestOwner, ".next/server/middleware-manifest.json", "unverified-edge-content", "Task 4 cannot prove compiled content for Edge instrumentation");
  }
  return evidence;
}

export function checkBuiltPublicDbBoundary(options: {
  readonly appPaths?: readonly string[];
  readonly manifestPath?: string;
  readonly rootDir: string;
}): PublicDbBoundaryReport {
  const preparation = prepareBuildBoundary(options);
  if (preparation.report) return preparation.report;
  const prepared = preparation.prepared;
  const middleware = scanGlobalBuildArtifacts(prepared.context);
  for (const appPath of prepared.appPaths) {
    scanAppPath(prepared, appPath, middleware.edgeFunctionAppPaths);
  }
  return boundaryReport(prepared.context.violations, prepared.context.visited);
}
