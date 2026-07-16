import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = process.cwd();

export function sourcePath(path: string): string {
  return resolve(projectRoot, path);
}

export function readSource(path: string): string {
  return readFileSync(sourcePath(path), "utf8");
}

export function routeFilesUnder(dir: string): string[] {
  const abs = resolve(projectRoot, dir);
  return readdirSync(abs, { withFileTypes: true }).flatMap((entry) => {
    const child = join(dir, entry.name);
    if (entry.isDirectory()) return routeFilesUnder(child);
    return entry.name === "route.ts" ? [child] : [];
  });
}

export function sectionBetween(
  source: string,
  start: string,
  end: string,
): string {
  const startIndex = source.indexOf(start);
  if (startIndex < 0) {
    throw new Error(`section start not found: ${start}`);
  }

  const endIndex = source.indexOf(end, startIndex + start.length);
  if (endIndex <= startIndex) {
    throw new Error(`section end not found after ${start}: ${end}`);
  }

  return source.slice(startIndex, endIndex);
}

/**
 * Extract a single top-level `export function <name>` body — from its
 * signature up to the next top-level `export ` declaration (or EOF for the
 * last one). Used to scope page-model-builder assertions to one page's builder
 * so a regression in a sibling builder can't false-satisfy the check.
 */
export function exportedFunctionSection(source: string, name: string): string {
  const start = source.indexOf(`export function ${name}`);
  if (start < 0) {
    throw new Error(`exported function not found: ${name}`);
  }
  const next = source.indexOf("\nexport ", start + 1);
  return next < 0 ? source.slice(start) : source.slice(start, next);
}
