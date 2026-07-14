import type {
  EntrypointKind,
  EntrypointMethod,
  EntrypointRepresentation,
} from "@/lib/public-content/entrypoints";

export interface DiscoveredSourceEntrypoint {
  readonly appPath: string;
  readonly kind: EntrypointKind;
  readonly methods: readonly EntrypointMethod[];
  readonly pathname: string;
  readonly representations: readonly EntrypointRepresentation[];
  readonly sourcePath: string;
}

export type AppPathsManifest = Readonly<Record<string, string>>;

export interface DiscoveredSourceRouteModule {
  readonly appPath: string;
  readonly buildModule: string;
  readonly methods: readonly EntrypointMethod[];
  readonly sourcePath: string;
}

export interface EntrypointInventoryValidation {
  readonly builtEntrypoints: readonly string[];
  readonly duplicateInventoryAppPaths: readonly string[];
  readonly duplicateSourceAppPaths: readonly string[];
  readonly mismatchedBuildModules: readonly string[];
  readonly mismatchedSourceContracts: readonly string[];
  readonly mismatchedSources: readonly string[];
  readonly missingFromBuild: readonly string[];
  readonly missingFromSource: readonly string[];
  readonly sourceEntrypoints: readonly DiscoveredSourceEntrypoint[];
  readonly unclassifiedBuild: readonly string[];
  readonly unclassifiedSource: readonly string[];
  assertComplete(): void;
}
