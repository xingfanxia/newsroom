import { existsSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import ts from "typescript";

export const SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);

export const ASSET_EXTENSION =
  /\.(?:css|gif|ico|jpe?g|less|png|sass|scss|svg|webp)$/i;

export const TURSO_SECRET =
  /\b(?:DATABASE_AUTH_TOKEN|DATABASE_URL|LIBSQL_AUTH_TOKEN|LIBSQL_URL|TURSO_API_TOKEN|TURSO_AUTH_TOKEN|TURSO_DATABASE_URL|TURSO_ORG)\b/;

export const NEXT_PAGE_IMPLICIT_BASENAMES = [
  "error",
  "forbidden",
  "global-error",
  "global-not-found",
  "layout",
  "loading",
  "not-found",
  "template",
  "unauthorized",
] as const;

export function toPosix(path: string): string {
  return path.split(sep).join("/").replaceAll("\\", "/");
}

export function isWithin(rootDir: string, path: string): boolean {
  const relativePath = relative(rootDir, path);
  return (
    relativePath === "" ||
    (!relativePath.startsWith(`..${sep}`) &&
      relativePath !== ".." &&
      !isAbsolute(relativePath))
  );
}

export function compilerOptionsFor(rootDir: string): ts.CompilerOptions {
  const configPath = ts.findConfigFile(rootDir, ts.sys.fileExists, "tsconfig.json");
  if (!configPath) {
    return {
      allowJs: true,
      baseUrl: rootDir,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      paths: { "@/*": ["*"] },
      resolveJsonModule: true,
    };
  }
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) {
    throw new Error(
      ts.flattenDiagnosticMessageText(config.error.messageText, "\n"),
    );
  }
  return ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    dirname(configPath),
  ).options;
}

export function sourceKind(path: string): ts.ScriptKind {
  if (path.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (path.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (path.endsWith(".cjs") || path.endsWith(".js") || path.endsWith(".mjs")) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

export function declarationRuntimeCandidates(path: string): string[] {
  if (path.endsWith(".d.mts")) return [`${path.slice(0, -6)}.mjs`];
  if (path.endsWith(".d.cts")) return [`${path.slice(0, -6)}.cjs`];
  if (!path.endsWith(".d.ts")) return [];
  const base = path.slice(0, -5);
  return [".js", ".jsx", ".mjs", ".cjs", ".json"].map(
    (extension) => `${base}${extension}`,
  );
}

export function existingConventionFiles(
  directory: string,
  basename: string,
  extensions: readonly string[] = [".tsx", ".ts", ".jsx", ".js"],
): string[] {
  const files: string[] = [];
  for (const extension of extensions) {
    const candidate = join(directory, `${basename}${extension}`);
    if (existsSync(candidate) && statSync(candidate).isFile()) files.push(candidate);
  }
  return files;
}

export function globalConventionSources(rootDir: string): string[] {
  const sources: string[] = [];
  for (const directory of [rootDir, join(rootDir, "src")]) {
    for (const basename of [
      "proxy",
      "middleware",
      "instrumentation",
      "instrumentation-client",
    ] as const) {
      const extensions =
        basename === "instrumentation-client"
          ? [".js", ".mjs", ".tsx", ".ts", ".jsx"]
          : undefined;
      sources.push(...existingConventionFiles(directory, basename, extensions));
    }
  }
  return sources;
}
