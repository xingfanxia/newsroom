import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, extname, join, relative } from "node:path";
import { requestPathInfoFor } from "@/scripts/verification/request-pathname";
import {
  NEXT_PAGE_IMPLICIT_BASENAMES,
  existingConventionFiles,
  isWithin,
  toPosix,
} from "./conventions";

const SLOT_BOUNDARY_BASENAMES = [
  "error",
  "forbidden",
  "layout",
  "loading",
  "not-found",
  "template",
  "unauthorized",
] as const;

interface BranchPageMatch {
  readonly intercepting: boolean;
  readonly path: string;
}

function appRootFor(rootDir: string, entrypointPath: string): string | null {
  for (const appDir of [join(rootDir, "app"), join(rootDir, "src/app")]) {
    if (isWithin(appDir, entrypointPath)) return appDir;
  }
  return null;
}

function pageAppPath(appDir: string, pagePath: string): string {
  const sourcePath = toPosix(relative(appDir, pagePath));
  return `/${sourcePath.slice(0, -extname(sourcePath).length)}`;
}

function addConventionFiles(
  implicit: Set<string>,
  directory: string,
  basenames: readonly string[],
): void {
  for (const basename of basenames) {
    for (const source of existingConventionFiles(directory, basename)) {
      implicit.add(source);
    }
  }
}

function addMatchedPageAndAncestors(
  implicit: Set<string>,
  branchRoot: string,
  pagePath: string,
): void {
  implicit.add(pagePath);
  let directory = dirname(pagePath);
  while (isWithin(branchRoot, directory)) {
    addConventionFiles(implicit, directory, SLOT_BOUNDARY_BASENAMES);
    if (directory === branchRoot) break;
    directory = dirname(directory);
  }
}

function addDefaultFallback(
  implicit: Set<string>,
  branchRoot: string,
): void {
  for (const fallback of existingConventionFiles(branchRoot, "default")) {
    addMatchedPageAndAncestors(implicit, branchRoot, fallback);
  }
}

function matchingBranchPages(
  appDir: string,
  directory: string,
  targetPathname: string,
): BranchPageMatch[] {
  const matches: BranchPageMatch[] = [];
  for (const page of existingConventionFiles(directory, "page")) {
    const info = requestPathInfoFor(pageAppPath(appDir, page));
    if (info.pathname === targetPathname) {
      matches.push({ intercepting: info.intercepting, path: page });
    }
  }
  for (const child of existsSync(directory) ? readdirSync(directory) : []) {
    if (child.startsWith("@")) continue;
    const childPath = join(directory, child);
    if (statSync(childPath).isDirectory()) {
      matches.push(
        ...matchingBranchPages(appDir, childPath, targetPathname),
      );
    }
  }
  return matches;
}

function activeBranchDirectories(
  branchRoot: string,
  matches: readonly BranchPageMatch[],
): string[] {
  const directories = new Set([branchRoot]);
  for (const match of matches) {
    let directory = dirname(match.path);
    while (isWithin(branchRoot, directory)) {
      directories.add(directory);
      if (directory === branchRoot) break;
      directory = dirname(directory);
    }
  }
  return [...directories];
}

function addActiveBranch(
  implicit: Set<string>,
  appDir: string,
  branchRoot: string,
  targetPathname: string,
): void {
  const matches = matchingBranchPages(appDir, branchRoot, targetPathname);
  for (const match of matches) {
    addMatchedPageAndAncestors(implicit, branchRoot, match.path);
  }
  if (!matches.some(({ intercepting }) => !intercepting)) {
    addDefaultFallback(implicit, branchRoot);
  }
  for (const directory of activeBranchDirectories(branchRoot, matches)) {
    addParallelSlots(implicit, appDir, directory, targetPathname);
  }
}

function addParallelSlots(
  implicit: Set<string>,
  appDir: string,
  directory: string,
  targetPathname: string,
): void {
  for (const child of existsSync(directory) ? readdirSync(directory) : []) {
    if (!child.startsWith("@")) continue;
    const slotRoot = join(directory, child);
    if (!statSync(slotRoot).isDirectory()) continue;
    addActiveBranch(implicit, appDir, slotRoot, targetPathname);
  }
}

function parallelSlotParents(
  appDir: string,
  entrypointPath: string,
): string[] {
  const parents = new Set<string>();
  let directory = dirname(entrypointPath);
  while (isWithin(appDir, directory)) {
    if (basename(directory).startsWith("@")) parents.add(dirname(directory));
    if (directory === appDir) break;
    directory = dirname(directory);
  }
  return [...parents];
}

function addImplicitChildrenBranch(
  implicit: Set<string>,
  appDir: string,
  entrypointPath: string,
  targetPathname: string,
): void {
  for (const parent of parallelSlotParents(appDir, entrypointPath)) {
    addActiveBranch(implicit, appDir, parent, targetPathname);
  }
}

function pageAncestors(appDir: string, entrypointPath: string): string[] {
  const directories: string[] = [];
  let current = dirname(entrypointPath);
  while (isWithin(appDir, current)) {
    directories.push(current);
    if (current === appDir) break;
    current = dirname(current);
  }
  return directories.reverse();
}

export function implicitPageSources(
  rootDir: string,
  entrypointPath: string,
): string[] {
  const appDir = appRootFor(rootDir, entrypointPath);
  if (!appDir) return [];
  const implicit = new Set<string>();
  const targetPathname = requestPathInfoFor(
    pageAppPath(appDir, entrypointPath),
  ).pathname;
  for (const directory of pageAncestors(appDir, entrypointPath)) {
    addConventionFiles(implicit, directory, NEXT_PAGE_IMPLICIT_BASENAMES);
    addParallelSlots(implicit, appDir, directory, targetPathname);
  }
  addImplicitChildrenBranch(
    implicit,
    appDir,
    entrypointPath,
    targetPathname,
  );
  implicit.delete(entrypointPath);
  return [...implicit];
}
