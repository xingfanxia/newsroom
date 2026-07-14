import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temporaryDirectories: string[] = [];

export function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "newsroom-entrypoints-"));
  temporaryDirectories.push(root);
  return root;
}

export function writeFixture(
  root: string,
  path: string,
  source: string,
): void {
  const absolutePath = join(root, path);
  mkdirSync(join(absolutePath, ".."), { recursive: true });
  writeFileSync(absolutePath, source);
}

export function cleanupFixtures(): void {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
}
