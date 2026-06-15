import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = process.cwd();

function sourcePath(path: string): string {
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
