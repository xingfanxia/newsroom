import ts from "typescript";
import { TURSO_SECRET, toPosix } from "./conventions";
import type { PublicDbBoundaryRule } from "./types";

export const DB_OWNING_LOADER_SOURCES = Object.freeze([
  "lib/api/daily-columns.ts",
  "lib/api/event-members.ts",
  "lib/api/feed-results.ts",
  "lib/api/item-detail.ts",
  "lib/api/public-items.ts",
  "lib/api/search-results.ts",
  "lib/api/source-catalog.ts",
  "lib/items/detail.ts",
  "lib/items/live.ts",
  "lib/items/saved.ts",
  "lib/items/semantic-search.ts",
  "lib/rss/legacy-feeds.ts",
  "lib/rss/main-feed.ts",
  "lib/rss/newsletter-feed.ts",
  "lib/shell/chrome-data.ts",
  "lib/shell/dashboard-stats.ts",
  "lib/shell/feed-cache.ts",
  "lib/shell/podcast-channels.ts",
  "lib/shell/system-stats.ts",
  "lib/shell/ticker.ts",
  "lib/shell/x-handles.ts",
  "lib/sources/live.ts",
]);

const DB_OWNING_LOADERS = new Set(DB_OWNING_LOADER_SOURCES);

export function isRuntimeLoaderModule(specifier: string): boolean {
  return specifier === "module" || specifier === "node:module";
}

export function ruleForImport(specifier: string): PublicDbBoundaryRule | null {
  if (
    specifier.startsWith("@libsql/") ||
    specifier === "libsql" ||
    specifier.startsWith("libsql/")
  ) {
    return "libsql-client";
  }
  if (specifier === "drizzle-orm" || specifier.startsWith("drizzle-orm/")) {
    return "drizzle-orm";
  }
  return null;
}

export function matchesPathAlias(
  specifier: string,
  paths: ts.MapLike<string[]> | undefined,
): boolean {
  return Object.keys(paths ?? {}).some((pattern) => {
    const wildcard = pattern.indexOf("*");
    if (wildcard === -1) return specifier === pattern;
    return (
      specifier.startsWith(pattern.slice(0, wildcard)) &&
      specifier.endsWith(pattern.slice(wildcard + 1))
    );
  });
}

export function rulesForSource(relativePath: string): PublicDbBoundaryRule[] {
  const rules: PublicDbBoundaryRule[] = [];
  if (relativePath === "db" || relativePath.startsWith("db/")) {
    rules.push("db-source");
  }
  if (
    relativePath.startsWith("lib/public-content/publisher/") ||
    relativePath.startsWith("workers/public-content/")
  ) {
    rules.push("publisher-source");
  }
  if (DB_OWNING_LOADERS.has(relativePath)) rules.push("db-owning-loader");
  return rules;
}

export function containsRuntimeTursoSecret(sourceFile: ts.SourceFile): boolean {
  let found = false;
  function visit(node: ts.Node): void {
    if (found) return;
    if (
      (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) &&
      TURSO_SECRET.test(node.text)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
}

export function buildRuleForPath(
  traceDependency: string,
  repositoryPath: string,
): PublicDbBoundaryRule | null {
  const normalizedDependency = toPosix(traceDependency);
  const normalizedRepositoryPath = toPosix(repositoryPath);
  const packagePath = `${normalizedDependency}/${normalizedRepositoryPath}`;
  if (
    /node_modules\/(?:@libsql\/[^/]+|libsql(?:-[^/]+)?)(?:\/|$)/.test(
      packagePath,
    )
  ) {
    return "libsql-client";
  }
  if (/node_modules\/drizzle-orm(?:-[^/]+)?(?:\/|$)/.test(packagePath)) {
    return "drizzle-orm";
  }
  if (
    normalizedRepositoryPath === "db" ||
    normalizedRepositoryPath.startsWith("db/")
  ) {
    return "db-source";
  }
  if (DB_OWNING_LOADERS.has(normalizedRepositoryPath)) {
    return "db-owning-loader";
  }
  if (
    normalizedRepositoryPath === "lib/public-content/publisher" ||
    normalizedRepositoryPath.startsWith("lib/public-content/publisher/") ||
    normalizedRepositoryPath === "workers/public-content" ||
    normalizedRepositoryPath.startsWith("workers/public-content/")
  ) {
    return "publisher-source";
  }
  if (TURSO_SECRET.test(packagePath)) return "turso-secret";
  return null;
}
