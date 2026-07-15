import { relative } from "node:path";
import { isWithin, toPosix } from "./conventions";

export function repositoryRelativePath(
  path: string,
  rootDir: string,
  physicalRootDir: string,
): string | null {
  if (isWithin(rootDir, path)) return toPosix(relative(rootDir, path));
  if (isWithin(physicalRootDir, path)) {
    return toPosix(relative(physicalRootDir, path));
  }
  return null;
}
