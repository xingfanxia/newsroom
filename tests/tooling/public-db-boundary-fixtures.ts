import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

const temporaryDirectories: string[] = [];

export const tursoDatabaseUrlKey = ["TURSO", "DATABASE", "URL"].join("_");

export function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "newsroom-public-db-boundary-"));
  temporaryDirectories.push(root);
  return root;
}

export function writeFixture(root: string, path: string, source: string): void {
  const absolutePath = join(root, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, source);
}

export function relativeImport(fromFile: string, toFile: string): string {
  const path = relative(dirname(fromFile), toFile).replaceAll("\\", "/");
  return path.startsWith(".") ? path : `./${path}`;
}

export function writeBuildModule(root: string, buildModule: string): void {
  writeEmptyMiddlewareManifest(root);
  writeFixture(root, `.next/server/${buildModule}`, "export {};\n");
}

export function writeEmptyMiddlewareManifest(root: string): void {
  const path = join(root, ".next/server/middleware-manifest.json");
  if (existsSync(path)) return;
  writeFixture(
    root,
    ".next/server/middleware-manifest.json",
    JSON.stringify({
      functions: {},
      middleware: {},
      sortedMiddleware: [],
      version: 3,
    }),
  );
}

export function cleanupFixtureRoots(): void {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
}
