import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { readSource, sourcePath } from "@/tests/helpers/source";

const SOURCE_ROOTS = ["app", "components"] as const;
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const SURFACE_CLASS_RE = /\bsurface-[a-z0-9-]+\b/g;

function sourceFilesUnder(dir: string): string[] {
  return readdirSync(sourcePath(dir), { withFileTypes: true }).flatMap(
    (entry) => {
      const child = join(dir, entry.name);
      if (entry.isDirectory()) return sourceFilesUnder(child);
      return SOURCE_EXTENSIONS.has(extname(entry.name)) ? [child] : [];
    },
  );
}

function surfaceDefinitions(): Set<string> {
  const css = [
    readSource("app/globals.css"),
    readSource("app/terminal.css"),
  ].join("\n");
  return new Set(
    [...css.matchAll(/\.((?:surface-)[a-z0-9-]+)\b/g)].map((m) => m[1]!),
  );
}

describe("shared surface CSS helpers", () => {
  test("defines every surface-* class used by app and components", () => {
    const defined = surfaceDefinitions();
    const missing = new Map<string, Set<string>>();

    for (const file of SOURCE_ROOTS.flatMap(sourceFilesUnder)) {
      const source = readFileSync(sourcePath(file), "utf8");
      for (const match of source.matchAll(SURFACE_CLASS_RE)) {
        const className = match[0];
        if (defined.has(className)) continue;
        const files = missing.get(className) ?? new Set<string>();
        files.add(relative(process.cwd(), sourcePath(file)));
        missing.set(className, files);
      }
    }

    expect(
      [...missing.entries()].map(([className, files]) => ({
        className,
        files: [...files].sort(),
      })),
    ).toEqual([]);
  });
});
