import { existsSync, readdirSync, statSync } from "node:fs";
import { extname, join, sep } from "node:path";

const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx"]);

export function toPosix(path: string): string {
  return path.split(sep).join("/");
}

export function walkSourceFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(directory).sort()) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const absolutePath = join(directory, entry);
    const stats = statSync(absolutePath);
    if (stats.isDirectory()) {
      if (!entry.startsWith("_")) files.push(...walkSourceFiles(absolutePath));
    } else if (stats.isFile() && SOURCE_EXTENSIONS.has(extname(entry))) {
      files.push(absolutePath);
    }
  }
  return files;
}

export function duplicates(values: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts]
    .filter(([, count]) => count > 1)
    .map(([value]) => value)
    .sort();
}
