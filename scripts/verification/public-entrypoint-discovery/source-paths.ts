import { relative } from "node:path";
import type ts from "typescript";
import { normalizeMetadataPageToRoute } from "next/dist/lib/metadata/get-metadata-route";
import {
  DEFAULT_METADATA_ROUTE_EXTENSIONS,
  isMetadataRouteFile,
} from "next/dist/lib/metadata/is-metadata-route";
import type { DevAppPageNormalizer } from "next/dist/server/normalizers/built/app/app-page-normalizer";
import { exportedRuntimeNames } from "./runtime-exports";
import { toPosix } from "./shared";

const ROUTE_SOURCE_PATTERN = /(?:^|\/)route\.(?:js|jsx|ts|tsx)$/;

export function isRouteSourcePath(sourcePath: string): boolean {
  return ROUTE_SOURCE_PATTERN.test(sourcePath);
}

export function compiledBuildModuleFor(sourcePath: string): string {
  return sourcePath.replace(/\.(?:js|jsx|ts|tsx)$/, ".js");
}

export function rawAppPathFor(relativeSourcePath: string): string | null {
  if (
    /^app\/(?:global-)?not-found\.(?:js|jsx|ts|tsx)$/.test(relativeSourcePath)
  ) {
    return "/_not-found/page";
  }
  const withoutApp = relativeSourcePath.replace(/^app\//, "");
  if (
    !/(?:^|\/)page\.(?:js|jsx|ts|tsx)$/.test(withoutApp) &&
    !isRouteSourcePath(withoutApp)
  ) {
    return null;
  }
  return `/${withoutApp.replace(/\.(?:js|jsx|ts|tsx)$/, "")}`;
}

export function metadataAppPathFor(
  absolutePath: string,
  appDir: string,
  normalizer: DevAppPageNormalizer,
  compilerOptions: ts.CompilerOptions,
): string | null {
  const appRelativePath = `/${toPosix(relative(appDir, absolutePath))}`;
  if (
    !isMetadataRouteFile(
      appRelativePath,
      DEFAULT_METADATA_ROUTE_EXTENSIONS,
      true,
    )
  ) {
    return null;
  }

  const basename = appRelativePath
    .slice(appRelativePath.lastIndexOf("/") + 1)
    .replace(/\.(?:js|jsx|ts|tsx)$/, "");
  const runtimeNames = exportedRuntimeNames(absolutePath, compilerOptions);
  const hasGenerator =
    (basename === "sitemap" && runtimeNames.has("generateSitemaps")) ||
    (["icon", "apple-icon", "opengraph-image", "twitter-image"].includes(
      basename,
    ) && runtimeNames.has("generateImageMetadata"));
  return normalizeMetadataPageToRoute(
    normalizer.normalize(absolutePath),
    hasGenerator,
  );
}
