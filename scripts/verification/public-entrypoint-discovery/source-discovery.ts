import { join, relative } from "node:path";
import { DEFAULT_METADATA_ROUTE_EXTENSIONS } from "next/dist/lib/metadata/is-metadata-route";
import { DevAppPageNormalizer } from "next/dist/server/normalizers/built/app/app-page-normalizer";
import type { EntrypointKind, EntrypointMethod } from "@/lib/public-content/entrypoints";
import {
  discoveryCompilerOptions,
  exportedRouteMethods,
} from "./runtime-exports";
import {
  compiledBuildModuleFor,
  isRouteSourcePath,
  metadataAppPathFor,
  rawAppPathFor,
} from "./source-paths";
import { requestPathnameFor } from "../request-pathname";
import { toPosix, walkSourceFiles } from "./shared";
import type {
  DiscoveredSourceEntrypoint,
  DiscoveredSourceRouteModule,
} from "./types";

export function discoverSourceEntrypoints(
  rootDir: string,
): DiscoveredSourceEntrypoint[] {
  const appDir = join(rootDir, "app");
  const compilerOptions = discoveryCompilerOptions(rootDir);
  const normalizer = new DevAppPageNormalizer(
    appDir,
    DEFAULT_METADATA_ROUTE_EXTENSIONS,
    true,
  );
  const discovered: DiscoveredSourceEntrypoint[] = [];

  for (const absolutePath of walkSourceFiles(appDir)) {
    const sourcePath = toPosix(relative(rootDir, absolutePath));
    const metadataAppPath = metadataAppPathFor(
      absolutePath,
      appDir,
      normalizer,
      compilerOptions,
    );
    const appPath = metadataAppPath ?? rawAppPathFor(sourcePath);
    if (!appPath) continue;

    const kind: EntrypointKind = appPath.endsWith("/page") ? "page" : "route";
    let methods: readonly EntrypointMethod[];
    if (kind === "page" || metadataAppPath !== null) {
      methods = ["GET", "HEAD"];
    } else {
      methods = exportedRouteMethods(absolutePath, compilerOptions);
      if (methods.length === 0) continue;
    }

    discovered.push({
      appPath,
      kind,
      methods,
      pathname: requestPathnameFor(appPath),
      representations: kind === "page" ? ["HTML", "RSC"] : [],
      sourcePath,
    });
  }

  return discovered.sort(
    (left, right) =>
      left.appPath.localeCompare(right.appPath) ||
      left.sourcePath.localeCompare(right.sourcePath),
  );
}

export function discoverSourceRouteModules(
  rootDir: string,
): DiscoveredSourceRouteModule[] {
  const compilerOptions = discoveryCompilerOptions(rootDir);
  return walkSourceFiles(join(rootDir, "app"))
    .filter((absolutePath) => isRouteSourcePath(toPosix(absolutePath)))
    .map((absolutePath) => {
      const sourcePath = toPosix(relative(rootDir, absolutePath));
      const appPath = rawAppPathFor(sourcePath);
      if (!appPath) {
        throw new Error(`Unable to derive raw app path for ${sourcePath}`);
      }
      return {
        appPath,
        buildModule: compiledBuildModuleFor(sourcePath),
        methods: exportedRouteMethods(absolutePath, compilerOptions),
        sourcePath,
      };
    })
    .sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
}
