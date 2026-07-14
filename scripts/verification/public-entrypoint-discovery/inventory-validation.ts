import type { PublicServingEntrypoint } from "@/lib/public-content/entrypoints";
import { duplicates } from "./shared";
import type {
  AppPathsManifest,
  DiscoveredSourceEntrypoint,
  DiscoveredSourceRouteModule,
  EntrypointInventoryValidation,
} from "./types";

interface ValidationOptions {
  readonly builtAppPaths: AppPathsManifest;
  readonly inventory: readonly PublicServingEntrypoint[];
  readonly sourceEntrypoints: readonly DiscoveredSourceEntrypoint[];
  readonly sourceRouteModules?: readonly DiscoveredSourceRouteModule[];
}

interface ValidationContext {
  readonly inventoryByAppPath: ReadonlyMap<string, PublicServingEntrypoint>;
  readonly nonServingRouteKeys: ReadonlySet<string>;
  readonly options: ValidationOptions;
  readonly sourceByAppPath: ReadonlyMap<string, DiscoveredSourceEntrypoint>;
}

type ValidationEvidence = Omit<EntrypointInventoryValidation, "assertComplete">;

function createValidationContext(options: ValidationOptions): ValidationContext {
  return {
    inventoryByAppPath: new Map(
      options.inventory.map((entrypoint) => [entrypoint.appPath, entrypoint]),
    ),
    nonServingRouteKeys: new Set(
      (options.sourceRouteModules ?? [])
        .filter((routeModule) => routeModule.methods.length === 0)
        .map(
          (routeModule) =>
            `${routeModule.appPath}\0${routeModule.buildModule}`,
        ),
    ),
    options,
    sourceByAppPath: new Map(
      options.sourceEntrypoints.map((entrypoint) => [
        entrypoint.appPath,
        entrypoint,
      ]),
    ),
  };
}

function builtEntrypointsFor(context: ValidationContext): string[] {
  const { builtAppPaths } = context.options;
  return Object.keys(builtAppPaths)
    .filter(
      (appPath) =>
        appPath.endsWith("/page") ||
        context.sourceByAppPath.has(appPath) ||
        appPath === "/robots.txt/route" ||
        appPath === "/sitemap.xml/route" ||
        (appPath.endsWith("/route") &&
          !context.nonServingRouteKeys.has(
            `${appPath}\0${builtAppPaths[appPath] ?? ""}`,
          )),
    )
    .sort();
}

function missingFromBuildFor(context: ValidationContext): string[] {
  return context.options.inventory
    .filter(
      (entrypoint) =>
        !(entrypoint.appPath in context.options.builtAppPaths),
    )
    .map((entrypoint) => entrypoint.appPath)
    .sort();
}

function mismatchedBuildModulesFor(context: ValidationContext): string[] {
  return context.options.inventory
    .filter((entrypoint) => {
      const builtModule = context.options.builtAppPaths[entrypoint.appPath];
      return builtModule !== undefined && builtModule !== entrypoint.buildModule;
    })
    .map((entrypoint) => entrypoint.appPath)
    .sort();
}

function mismatchedSourcesFor(context: ValidationContext): string[] {
  return context.options.inventory
    .filter((entrypoint) => {
      const discovered = context.sourceByAppPath.get(entrypoint.appPath);
      return (
        entrypoint.sourcePath !== null &&
        discovered !== undefined &&
        discovered.sourcePath !== entrypoint.sourcePath
      );
    })
    .map((entrypoint) => entrypoint.appPath)
    .sort();
}

function missingFromSourceFor(context: ValidationContext): string[] {
  return context.options.inventory
    .filter(
      (entrypoint) =>
        entrypoint.sourcePath !== null &&
        !context.sourceByAppPath.has(entrypoint.appPath),
    )
    .map((entrypoint) => entrypoint.appPath)
    .sort();
}

function sourceContractMatches(
  inventory: PublicServingEntrypoint,
  discovered: DiscoveredSourceEntrypoint,
): boolean {
  return (
    discovered.kind === inventory.kind &&
    discovered.pathname === inventory.pathname &&
    discovered.methods.join("\0") === inventory.methods.join("\0") &&
    discovered.representations.join("\0") ===
      inventory.representations.join("\0")
  );
}

function mismatchedSourceContractsFor(context: ValidationContext): string[] {
  return context.options.inventory
    .filter((entrypoint) => {
      const discovered = context.sourceByAppPath.get(entrypoint.appPath);
      return discovered !== undefined && !sourceContractMatches(entrypoint, discovered);
    })
    .map((entrypoint) => entrypoint.appPath)
    .sort();
}

function collectValidationEvidence(
  context: ValidationContext,
): ValidationEvidence {
  const builtEntrypoints = builtEntrypointsFor(context);
  return {
    builtEntrypoints,
    duplicateInventoryAppPaths: duplicates(
      context.options.inventory.map((entrypoint) => entrypoint.appPath),
    ),
    duplicateSourceAppPaths: duplicates(
      context.options.sourceEntrypoints.map((entrypoint) => entrypoint.appPath),
    ),
    mismatchedBuildModules: mismatchedBuildModulesFor(context),
    mismatchedSourceContracts: mismatchedSourceContractsFor(context),
    mismatchedSources: mismatchedSourcesFor(context),
    missingFromBuild: missingFromBuildFor(context),
    missingFromSource: missingFromSourceFor(context),
    sourceEntrypoints: context.options.sourceEntrypoints,
    unclassifiedBuild: builtEntrypoints
      .filter((appPath) => !context.inventoryByAppPath.has(appPath))
      .sort(),
    unclassifiedSource: context.options.sourceEntrypoints
      .filter(
        (entrypoint) => !context.inventoryByAppPath.has(entrypoint.appPath),
      )
      .map((entrypoint) => entrypoint.appPath)
      .sort(),
  };
}

function assertComplete(evidence: ValidationEvidence): void {
  const failures = [
    ["Duplicate inventory app paths", evidence.duplicateInventoryAppPaths],
    ["Duplicate source app paths", evidence.duplicateSourceAppPaths],
    ["Unclassified source", evidence.unclassifiedSource],
    ["Unclassified build", evidence.unclassifiedBuild],
    ["Missing from build", evidence.missingFromBuild],
    ["Mismatched build modules", evidence.mismatchedBuildModules],
    ["Mismatched sources", evidence.mismatchedSources],
    ["Missing from source", evidence.missingFromSource],
    ["Mismatched source contracts", evidence.mismatchedSourceContracts],
  ]
    .filter(([, values]) => (values as readonly string[]).length > 0)
    .map(
      ([label, values]) =>
        `${label}: ${(values as readonly string[]).join(", ")}`,
    );
  if (failures.length > 0) throw new Error(failures.join("\n"));
}

export function validateEntrypointInventory(
  options: ValidationOptions,
): EntrypointInventoryValidation {
  const evidence = collectValidationEvidence(createValidationContext(options));
  return {
    ...evidence,
    assertComplete() {
      assertComplete(evidence);
    },
  };
}
