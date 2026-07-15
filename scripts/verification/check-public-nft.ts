import {
  existsSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import {
  ANONYMOUS_SERVING_ENTRYPOINTS,
  type PublicServingEntrypoint,
} from "@/lib/public-content/entrypoints";
import { checkBuiltPublicDbBoundary } from "@/scripts/ops/check-public-db-boundary";
import { boundaryReport } from "@/scripts/ops/public-db-boundary/report";
import {
  globalConventionSources,
  isWithin,
  toPosix,
  TURSO_SECRET,
} from "@/scripts/ops/public-db-boundary/conventions";
import type {
  PublicDbBoundaryReport,
  PublicDbBoundaryRule,
  PublicDbBoundaryViolation,
} from "@/scripts/ops/public-db-boundary/types";
import { readAppPathsManifest } from "./discover-public-entrypoints";

type OwnedArtifact = {
  readonly owner: string;
  readonly path: string;
};

const COMPILED_PATTERNS: readonly {
  readonly rule: PublicDbBoundaryRule;
  readonly pattern: RegExp;
}[] = [
  {
    rule: "libsql-client",
    pattern: /@libsql(?:\/|\\u002f)|(?:^|[^a-z])libsql(?:-client|:\/\/|\/client)/i,
  },
  { rule: "drizzle-orm", pattern: /drizzle-orm/i },
  {
    rule: "db-source",
    pattern: /(?:\[project\]|["'])\/?db\/client(?:\.[cm]?[jt]s)?/i,
  },
  {
    rule: "publisher-source",
    pattern: /(?:lib\/public-content\/publisher|workers\/public-content)/i,
  },
] as const;

function addViolation(
  violations: PublicDbBoundaryViolation[],
  rootDir: string,
  artifact: OwnedArtifact,
  rule: PublicDbBoundaryRule,
  detail: string,
): void {
  violations.push({
    detail,
    entrypoint: artifact.owner,
    file: toPosix(relative(rootDir, artifact.path)),
    importChain: [],
    rule,
  });
}

function addOwnedArtifact(
  artifacts: Map<string, Set<string>>,
  rootDir: string,
  owner: string,
  path: string,
  violations: PublicDbBoundaryViolation[],
): void {
  const distRoot = join(rootDir, ".next");
  const absolutePath = resolve(path);
  const artifact = { owner, path: absolutePath };
  if (!isWithin(distRoot, absolutePath)) {
    addViolation(
      violations,
      rootDir,
      artifact,
      "unsafe-manifest-path",
      "Compiled artifact escapes .next",
    );
    return;
  }
  if (!existsSync(absolutePath)) {
    addViolation(
      violations,
      rootDir,
      artifact,
      "missing-build-module",
      "Compiled artifact is missing",
    );
    return;
  }
  if (!statSync(absolutePath).isFile()) {
    addViolation(
      violations,
      rootDir,
      artifact,
      "invalid-build-module",
      "Compiled artifact is not a regular file",
    );
    return;
  }
  if (!isWithin(realpathSync(distRoot), realpathSync(absolutePath))) {
    addViolation(
      violations,
      rootDir,
      artifact,
      "unsafe-manifest-path",
      "Compiled artifact physically escapes .next",
    );
    return;
  }
  const owners = artifacts.get(absolutePath) ?? new Set<string>();
  owners.add(owner);
  artifacts.set(absolutePath, owners);
}

function collectTrace(
  artifacts: Map<string, Set<string>>,
  rootDir: string,
  owner: string,
  modulePath: string,
  violations: PublicDbBoundaryViolation[],
): void {
  const tracePath = `${modulePath}.nft.json`;
  if (!existsSync(tracePath) || !statSync(tracePath).isFile()) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(tracePath, "utf8"));
  } catch {
    return;
  }
  const files = (parsed as { files?: unknown })?.files;
  if (!Array.isArray(files) || !files.every((file) => typeof file === "string")) {
    return;
  }
  for (const file of files) {
    const path = resolve(dirname(tracePath), file);
    if (isWithin(join(rootDir, ".next"), path)) {
      addOwnedArtifact(artifacts, rootDir, owner, path, violations);
    }
  }
}

function collectClientReferenceManifest(
  artifacts: Map<string, Set<string>>,
  rootDir: string,
  owner: string,
  buildModule: string,
  violations: PublicDbBoundaryViolation[],
): void {
  const manifestPath = join(
    rootDir,
    ".next/server",
    buildModule.replace(/\.js$/, "_client-reference-manifest.js"),
  );
  if (!existsSync(manifestPath)) return;
  addOwnedArtifact(artifacts, rootDir, owner, manifestPath, violations);
  const source = readFileSync(manifestPath, "utf8");
  const paths = source.matchAll(
    /["'](?:\/_next\/)?((?:static|server)\/chunks\/[^"']+?\.js)["']/g,
  );
  for (const match of paths) {
    addOwnedArtifact(
      artifacts,
      rootDir,
      owner,
      join(rootDir, ".next", match[1] as string),
      violations,
    );
  }
}

function collectEntrypointArtifacts(
  artifacts: Map<string, Set<string>>,
  rootDir: string,
  entrypoints: readonly PublicServingEntrypoint[],
  violations: PublicDbBoundaryViolation[],
): void {
  const serverRoot = join(rootDir, ".next/server");
  const manifest = readAppPathsManifest(join(serverRoot, "app-paths-manifest.json"));
  for (const entrypoint of entrypoints) {
    const buildModule = manifest[entrypoint.appPath];
    if (!buildModule) continue;
    const modulePath = join(serverRoot, buildModule);
    addOwnedArtifact(
      artifacts,
      rootDir,
      entrypoint.appPath,
      modulePath,
      violations,
    );
    collectTrace(
      artifacts,
      rootDir,
      entrypoint.appPath,
      modulePath,
      violations,
    );
    collectClientReferenceManifest(
      artifacts,
      rootDir,
      entrypoint.appPath,
      buildModule,
      violations,
    );
  }
}

function conventionOwner(rootDir: string, basename: string): string | null {
  const source = globalConventionSources(rootDir).find((path) =>
    new RegExp(`(?:^|/)${basename}\\.[^.]+$`).test(toPosix(path)),
  );
  return source ? toPosix(relative(rootDir, source)) : null;
}

function collectGlobalServerArtifacts(
  artifacts: Map<string, Set<string>>,
  rootDir: string,
  violations: PublicDbBoundaryViolation[],
): void {
  const serverRoot = join(rootDir, ".next/server");
  const requestOwner =
    conventionOwner(rootDir, "proxy") ?? conventionOwner(rootDir, "middleware");
  const instrumentationOwner = conventionOwner(rootDir, "instrumentation");
  for (const [owner, basename] of [
    [requestOwner, "middleware.js"],
    [instrumentationOwner, "instrumentation.js"],
  ] as const) {
    if (!owner) continue;
    const modulePath = join(serverRoot, basename);
    addOwnedArtifact(artifacts, rootDir, owner, modulePath, violations);
    collectTrace(artifacts, rootDir, owner, modulePath, violations);
  }
}

function definitionFiles(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const definition = value as Record<string, unknown>;
  const files = [definition.entrypoint, ...(Array.isArray(definition.files) ? definition.files : [])];
  return files.filter((file): file is string => typeof file === "string");
}

function collectEdgeArtifacts(
  artifacts: Map<string, Set<string>>,
  rootDir: string,
  selectedAppPaths: ReadonlySet<string>,
  violations: PublicDbBoundaryViolation[],
): void {
  const manifestPath = join(rootDir, ".next/server/middleware-manifest.json");
  if (!existsSync(manifestPath)) return;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    functions?: Record<string, unknown>;
    instrumentation?: { files?: unknown };
    middleware?: Record<string, unknown>;
  };
  const requestOwner =
    conventionOwner(rootDir, "proxy") ??
    conventionOwner(rootDir, "middleware") ??
    "<middleware>";
  for (const definition of Object.values(manifest.middleware ?? {})) {
    for (const file of definitionFiles(definition)) {
      addOwnedArtifact(
        artifacts,
        rootDir,
        requestOwner,
        join(rootDir, ".next", file),
        violations,
      );
    }
  }
  for (const [appPath, definition] of Object.entries(manifest.functions ?? {})) {
    if (!selectedAppPaths.has(appPath)) continue;
    for (const file of definitionFiles(definition)) {
      addOwnedArtifact(
        artifacts,
        rootDir,
        appPath,
        join(rootDir, ".next", file),
        violations,
      );
    }
  }
  const instrumentationFiles = manifest.instrumentation?.files;
  if (Array.isArray(instrumentationFiles)) {
    const owner = conventionOwner(rootDir, "instrumentation") ?? "<instrumentation>";
    for (const file of instrumentationFiles) {
      if (typeof file === "string") {
        addOwnedArtifact(
          artifacts,
          rootDir,
          owner,
          join(rootDir, ".next", file),
          violations,
        );
      }
    }
  }
}

function collectGlobalClientArtifacts(
  artifacts: Map<string, Set<string>>,
  rootDir: string,
  violations: PublicDbBoundaryViolation[],
): void {
  const manifestPath = join(rootDir, ".next/build-manifest.json");
  if (!existsSync(manifestPath)) return;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    polyfillFiles?: unknown;
    rootMainFiles?: unknown;
  };
  const files = [manifest.polyfillFiles, manifest.rootMainFiles]
    .flatMap((value) => (Array.isArray(value) ? value : []))
    .filter((file): file is string => typeof file === "string");
  const owner = conventionOwner(rootDir, "instrumentation-client") ?? "<client-runtime>";
  for (const file of files) {
    addOwnedArtifact(
      artifacts,
      rootDir,
      owner,
      join(rootDir, ".next", file),
      violations,
    );
  }
}

function scanCompiledContent(
  artifacts: Map<string, Set<string>>,
  rootDir: string,
  violations: PublicDbBoundaryViolation[],
): void {
  for (const [path, owners] of artifacts) {
    const source = readFileSync(path, "utf8");
    for (const owner of owners) {
      const artifact = { owner, path };
      for (const { pattern, rule } of COMPILED_PATTERNS) {
        if (pattern.test(source)) {
          addViolation(
            violations,
            rootDir,
            artifact,
            rule,
            `Forbidden ${rule} marker in compiled bytes`,
          );
        }
      }
      if (TURSO_SECRET.test(source)) {
        addViolation(
          violations,
          rootDir,
          artifact,
          "turso-secret",
          "Forbidden Turso environment name in compiled bytes",
        );
      }
    }
  }
}

export function checkPublicNftBoundary(options: {
  readonly entrypoints?: readonly PublicServingEntrypoint[];
  readonly rootDir: string;
}): PublicDbBoundaryReport {
  const rootDir = resolve(options.rootDir);
  const entrypoints = options.entrypoints ?? ANONYMOUS_SERVING_ENTRYPOINTS;
  const appPaths = entrypoints.map((entrypoint) => entrypoint.appPath);
  const base = checkBuiltPublicDbBoundary({ appPaths, rootDir });
  const violations = base.violations.filter(
    (violation) => violation.rule !== "unverified-edge-content",
  );
  const artifacts = new Map<string, Set<string>>();
  try {
    collectEntrypointArtifacts(
      artifacts,
      rootDir,
      entrypoints,
      violations,
    );
    collectGlobalServerArtifacts(artifacts, rootDir, violations);
    collectEdgeArtifacts(
      artifacts,
      rootDir,
      new Set(appPaths),
      violations,
    );
    collectGlobalClientArtifacts(artifacts, rootDir, violations);
    scanCompiledContent(artifacts, rootDir, violations);
  } catch (error) {
    violations.push({
      detail: error instanceof Error ? error.message : "Compiled evidence is unreadable",
      entrypoint: "<compiled-evidence>",
      file: ".next",
      importChain: [],
      rule: "malformed-manifest",
    });
  }
  return boundaryReport(violations, [
    ...base.visitedFiles,
    ...artifacts.keys().map((path) => toPosix(relative(rootDir, path))),
  ]);
}

if (import.meta.main) {
  const report = checkPublicNftBoundary({ rootDir: process.cwd() });
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}
