import {
  existsSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { extname, relative, resolve } from "node:path";
import ts from "typescript";
import {
  ASSET_EXTENSION,
  SOURCE_EXTENSIONS,
  compilerOptionsFor,
  declarationRuntimeCandidates,
  globalConventionSources,
  isWithin,
  sourceKind,
  toPosix,
} from "./conventions";
import { collectImportReferences, type ImportReference } from "./import-references";
import { boundaryReport } from "./report";
import { repositoryRelativePath } from "./source-paths";
import { implicitPageSources } from "./source-roots";
import { sourceRuleFindings } from "./source-rules";
import type { EntrypointScan, SourceFileEvidence } from "./source-types";
import {
  containsRuntimeTursoSecret,
  isRuntimeLoaderModule,
  matchesPathAlias,
  ruleForImport,
} from "./rules";
import type {
  PublicDbBoundaryReport,
  PublicDbBoundaryRule,
  PublicDbBoundaryViolation,
} from "./types";

class SourceBoundaryScanner {
  private readonly allVisited = new Set<string>();
  private readonly compilerOptions: ts.CompilerOptions;
  private readonly globalRoots: readonly string[];
  private readonly moduleHost: ts.ModuleResolutionHost;
  private readonly physicalRootDir: string;
  private readonly rootDir: string;
  private readonly seenViolations = new Set<string>();
  private readonly violations: PublicDbBoundaryViolation[] = [];

  constructor(rootDir: string) {
    this.rootDir = resolve(rootDir);
    this.physicalRootDir = realpathSync(this.rootDir);
    this.compilerOptions = compilerOptionsFor(this.rootDir);
    this.globalRoots = globalConventionSources(this.rootDir);
    this.moduleHost = {
      directoryExists: ts.sys.directoryExists,
      fileExists: ts.sys.fileExists,
      getCurrentDirectory: () => this.rootDir,
      getDirectories: ts.sys.getDirectories,
      realpath: ts.sys.realpath,
      readFile: ts.sys.readFile,
    };
  }

  check(entrypointSources: readonly string[]): PublicDbBoundaryReport {
    for (const source of [...entrypointSources].sort()) this.scanEntrypoint(source);
    return boundaryReport(this.violations, this.allVisited);
  }

  private addViolation(
    scan: EntrypointScan,
    file: string,
    rule: PublicDbBoundaryRule,
    importChain: readonly string[],
    detail: string,
  ): void {
    const key = `${scan.entrypoint}\0${file}\0${rule}\0${importChain.join("\0")}\0${detail}`;
    if (this.seenViolations.has(key)) return;
    this.seenViolations.add(key);
    this.violations.push({
      detail,
      entrypoint: scan.entrypoint,
      file,
      importChain,
      rule,
    });
  }

  private scanEntrypoint(entrypointSource: string): void {
    const absolutePath = resolve(this.rootDir, entrypointSource);
    const relativePath = toPosix(relative(this.rootDir, absolutePath));
    const scan = { entrypoint: relativePath, visited: new Set<string>() };
    if (!isWithin(this.rootDir, absolutePath)) {
      scan.entrypoint = entrypointSource;
      this.addViolation(scan, entrypointSource, "unsafe-source-path", [entrypointSource], "Entrypoint escapes repository root");
      return;
    }
    if (!existsSync(absolutePath)) {
      this.addViolation(scan, relativePath, "missing-source", [relativePath], "Entrypoint source does not exist");
      return;
    }
    if (!isWithin(this.physicalRootDir, realpathSync(absolutePath))) {
      this.addViolation(scan, relativePath, "unsafe-source-path", [relativePath], "Entrypoint physically escapes repository root");
      return;
    }
    for (const root of this.rootsForEntrypoint(absolutePath)) {
      const rootRelative = toPosix(relative(this.rootDir, root));
      const chain = root === absolutePath ? [relativePath] : [relativePath, rootRelative];
      this.visit(scan, root, chain);
    }
  }

  private rootsForEntrypoint(entrypointPath: string): readonly string[] {
    const roots = [entrypointPath, ...this.globalRoots];
    if (
      /\/page\.(?:js|jsx|ts|tsx)$/.test(entrypointPath) ||
      /\/app\/not-found\.(?:js|jsx|ts|tsx)$/.test(entrypointPath)
    ) {
      roots.push(...implicitPageSources(this.rootDir, entrypointPath));
    }
    return [...new Set(roots)];
  }

  private visit(
    scan: EntrypointScan,
    absolutePath: string,
    chain: readonly string[],
  ): void {
    const evidence = this.readSourceEvidence(scan, absolutePath, chain);
    if (!evidence) return;
    this.scanPathRules(scan, evidence, chain);
    if (!SOURCE_EXTENSIONS.has(extname(evidence.absolutePath))) return;
    const sourceFile = ts.createSourceFile(
      evidence.absolutePath,
      evidence.source,
      ts.ScriptTarget.Latest,
      true,
      sourceKind(evidence.absolutePath),
    );
    if (containsRuntimeTursoSecret(sourceFile)) {
      this.addViolation(scan, evidence.relativePath, "turso-secret", chain, "Forbidden turso-secret reached");
    }
    for (const reference of collectImportReferences(sourceFile)) {
      this.scanReference(scan, sourceFile, evidence, reference, chain);
    }
  }

  private readSourceEvidence(
    scan: EntrypointScan,
    absolutePath: string,
    chain: readonly string[],
  ): SourceFileEvidence | null {
    const normalizedPath = resolve(absolutePath);
    const repositoryRelative = repositoryRelativePath(
      normalizedPath,
      this.rootDir,
      this.physicalRootDir,
    );
    if (repositoryRelative === null) {
      this.addViolation(scan, toPosix(normalizedPath), "unsafe-source-path", chain, "Resolved source escapes repository root");
      return null;
    }
    const relativePath = repositoryRelative;
    if (scan.visited.has(relativePath)) return null;
    scan.visited.add(relativePath);
    this.allVisited.add(relativePath);
    if (!existsSync(normalizedPath)) {
      this.addViolation(scan, relativePath, "missing-source", chain, "Resolved source does not exist");
      return null;
    }
    const physicalPath = realpathSync(normalizedPath);
    if (!isWithin(this.physicalRootDir, physicalPath)) {
      this.addViolation(scan, relativePath, "unsafe-source-path", chain, "Resolved source physically escapes repository root");
      return null;
    }
    return {
      absolutePath: normalizedPath,
      physicalRelativePath: toPosix(relative(this.physicalRootDir, physicalPath)),
      relativePath,
      source: readFileSync(normalizedPath, "utf8"),
    };
  }

  private scanPathRules(
    scan: EntrypointScan,
    evidence: SourceFileEvidence,
    chain: readonly string[],
  ): void {
    for (const finding of sourceRuleFindings(evidence)) {
      this.addViolation(scan, finding.file, finding.rule, chain, finding.detail);
    }
  }

  private scanReference(
    scan: EntrypointScan,
    sourceFile: ts.SourceFile,
    evidence: SourceFileEvidence,
    reference: ImportReference,
    chain: readonly string[],
  ): void {
    if (!reference.literal || reference.specifier === null) {
      this.addViolation(scan, evidence.relativePath, "nonliteral-import", chain, "Computed or indirect import/require cannot be proven pure");
      return;
    }
    if (reference.runtime && isRuntimeLoaderModule(reference.specifier)) {
      this.addViolation(scan, reference.specifier, "nonliteral-import", chain, `Runtime loader ${reference.specifier} cannot be proven pure`);
      return;
    }
    const directRule = ruleForImport(reference.specifier);
    if (directRule) {
      this.addViolation(scan, reference.specifier, directRule, chain, `Forbidden package ${reference.specifier}`);
      return;
    }
    const resolution = ts.resolveModuleName(
      reference.specifier,
      evidence.absolutePath,
      this.compilerOptions,
      this.moduleHost,
    ).resolvedModule;
    if (!resolution) return this.handleUnresolved(scan, reference.specifier, chain);
    this.scanResolvedReference(
      scan,
      sourceFile,
      { runtime: reference.runtime, specifier: reference.specifier },
      resolution,
      chain,
    );
  }

  private handleUnresolved(
    scan: EntrypointScan,
    specifier: string,
    chain: readonly string[],
  ): void {
    const internal =
      specifier.startsWith(".") ||
      specifier.startsWith("/") ||
      matchesPathAlias(specifier, this.compilerOptions.paths);
    if (internal && !ASSET_EXTENSION.test(specifier)) {
      this.addViolation(scan, specifier, "unresolved-internal-import", chain, `Unable to resolve internal import ${specifier}`);
    }
  }

  private scanResolvedReference(
    scan: EntrypointScan,
    sourceFile: ts.SourceFile,
    reference: Pick<ImportReference, "runtime"> & { readonly specifier: string },
    resolution: ts.ResolvedModuleFull,
    chain: readonly string[],
  ): void {
    const resolvedPath = resolve(resolution.resolvedFileName);
    const internal =
      reference.specifier.startsWith(".") ||
      reference.specifier.startsWith("/") ||
      matchesPathAlias(reference.specifier, this.compilerOptions.paths);
    if (!internal && (resolution.isExternalLibraryImport || toPosix(resolvedPath).includes("/node_modules/"))) return;
    const child =
      repositoryRelativePath(resolvedPath, this.rootDir, this.physicalRootDir) ??
      toPosix(resolvedPath);
    this.visit(scan, resolvedPath, [...chain, child]);
    if (reference.runtime && !sourceFile.isDeclarationFile) {
      this.scanDeclarationRuntime(scan, reference.specifier, resolvedPath, child, chain);
    }
  }

  private scanDeclarationRuntime(
    scan: EntrypointScan,
    specifier: string,
    resolvedPath: string,
    child: string,
    chain: readonly string[],
  ): void {
    const candidates = declarationRuntimeCandidates(resolvedPath);
    if (candidates.length === 0 || ASSET_EXTENSION.test(specifier)) return;
    const runtimes = candidates.filter((path) => existsSync(path) && statSync(path).isFile());
    if (runtimes.length === 0) {
      this.addViolation(scan, child, "unresolved-internal-import", chain, `Runtime import ${specifier} resolves only to declaration ${child}`);
    }
    for (const runtime of runtimes) {
      const runtimeChild = toPosix(relative(this.rootDir, runtime));
      this.visit(scan, runtime, [...chain, runtimeChild]);
    }
  }
}

export function checkSourcePublicDbBoundary(options: {
  readonly entrypointSources: readonly string[];
  readonly rootDir: string;
}): PublicDbBoundaryReport {
  return new SourceBoundaryScanner(options.rootDir).check(options.entrypointSources);
}
