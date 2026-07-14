import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import ts from "typescript";
import type { EntrypointMethod } from "@/lib/public-content/entrypoints";
import { commonJsRuntimeNames } from "./commonjs-runtime-exports";
import {
  collectBindingNames,
  hasDeclareModifier,
  hasDefaultModifier,
  hasExportModifier,
  staticPropertyName,
  unwrapExpression,
} from "./typescript-ast";

const ROUTE_METHODS = new Set<EntrypointMethod>(["GET", "HEAD"]);

interface RuntimeExportContext {
  readonly compilerOptions: ts.CompilerOptions;
  readonly seen: Set<string>;
}

export function discoveryCompilerOptions(rootDir: string): ts.CompilerOptions {
  const configPath = ts.findConfigFile(rootDir, ts.sys.fileExists, "tsconfig.json");
  if (!configPath) {
    return {
      allowJs: true,
      baseUrl: rootDir,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      paths: { "@/*": ["*"] },
    };
  }
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) {
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
  }
  return ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    dirname(configPath),
  ).options;
}

function parseSourceFile(sourcePath: string): ts.SourceFile {
  const source = readFileSync(sourcePath, "utf8");
  return ts.createSourceFile(
    sourcePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    sourcePath.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function addConservativeServingNames(names: Set<string>): void {
  names.add("GET");
  names.add("HEAD");
}

function addStarExportRuntimeNames(
  statement: ts.ExportDeclaration,
  sourcePath: string,
  names: Set<string>,
  context: RuntimeExportContext,
): void {
  if (!statement.moduleSpecifier || !ts.isStringLiteralLike(statement.moduleSpecifier)) {
    return;
  }
  const resolution = ts.resolveModuleName(
    statement.moduleSpecifier.text,
    sourcePath,
    context.compilerOptions,
    ts.sys,
  ).resolvedModule;
  if (
    !resolution ||
    resolution.isExternalLibraryImport ||
    /\.d\.(?:cts|mts|ts)$/.test(resolution.resolvedFileName)
  ) {
    // TypeScript and Next can select different conditional exports. An
    // unresolved or external surface cannot prove the runtime is POST-only.
    addConservativeServingNames(names);
    return;
  }
  for (const name of scanExportedRuntimeNames(resolution.resolvedFileName, context)) {
    names.add(name);
  }
}

function addExportDeclarationRuntimeNames(
  statement: ts.ExportDeclaration,
  sourcePath: string,
  names: Set<string>,
  context: RuntimeExportContext,
): void {
  if (statement.isTypeOnly) return;
  if (statement.exportClause && ts.isNamespaceExport(statement.exportClause)) {
    names.add(statement.exportClause.name.text);
    return;
  }
  if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
    for (const element of statement.exportClause.elements) {
      if (!element.isTypeOnly) names.add(element.name.text);
    }
    return;
  }
  if (!statement.exportClause) {
    addStarExportRuntimeNames(statement, sourcePath, names, context);
  }
}

function addExportEqualsRuntimeNames(
  statement: ts.ExportAssignment,
  sourcePath: string,
  names: Set<string>,
): void {
  if (!statement.isExportEquals) return;
  const expression = unwrapExpression(statement.expression);
  if (!ts.isObjectLiteralExpression(expression)) {
    throw new Error(`Unsupported export-equals runtime target in ${sourcePath}`);
  }
  for (const property of expression.properties) {
    if (ts.isSpreadAssignment(property)) {
      throw new Error(`Unsupported export-equals runtime target in ${sourcePath}`);
    }
    if (ts.isShorthandPropertyAssignment(property)) {
      names.add(property.name.text);
      continue;
    }
    const name = staticPropertyName(property.name);
    if (name === null) {
      throw new Error(`Unsupported export-equals runtime target in ${sourcePath}`);
    }
    names.add(name);
  }
}

function addNamedDeclarationRuntimeName(
  statement: ts.Statement,
  names: Set<string>,
): boolean {
  if (
    (ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isEnumDeclaration(statement) ||
      ts.isModuleDeclaration(statement)) &&
    statement.name &&
    ts.isIdentifier(statement.name) &&
    hasExportModifier(statement) &&
    !hasDefaultModifier(statement) &&
    !hasDeclareModifier(statement)
  ) {
    names.add(statement.name.text);
    return true;
  }
  if (
    ts.isImportEqualsDeclaration(statement) &&
    hasExportModifier(statement) &&
    !statement.isTypeOnly
  ) {
    names.add(statement.name.text);
    return true;
  }
  return false;
}

function addStatementRuntimeNames(
  statement: ts.Statement,
  sourcePath: string,
  names: Set<string>,
  context: RuntimeExportContext,
): void {
  if (addNamedDeclarationRuntimeName(statement, names)) return;
  if (ts.isVariableStatement(statement) && hasExportModifier(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      collectBindingNames(declaration.name, names);
    }
    return;
  }
  if (ts.isExportDeclaration(statement)) {
    addExportDeclarationRuntimeNames(statement, sourcePath, names, context);
    return;
  }
  if (ts.isExportAssignment(statement)) {
    addExportEqualsRuntimeNames(statement, sourcePath, names);
  }
}

function scanExportedRuntimeNames(
  sourcePath: string,
  context: RuntimeExportContext,
): Set<string> {
  if (context.seen.has(sourcePath)) return new Set();
  context.seen.add(sourcePath);
  const sourceFile = parseSourceFile(sourcePath);
  const names = commonJsRuntimeNames(sourceFile, sourcePath);
  for (const statement of sourceFile.statements) {
    addStatementRuntimeNames(statement, sourcePath, names, context);
  }
  return names;
}

export function exportedRuntimeNames(
  sourcePath: string,
  compilerOptions: ts.CompilerOptions,
  seen = new Set<string>(),
): Set<string> {
  return scanExportedRuntimeNames(sourcePath, { compilerOptions, seen });
}

export function exportedRouteMethods(
  sourcePath: string,
  compilerOptions: ts.CompilerOptions,
): EntrypointMethod[] {
  const methods = new Set<EntrypointMethod>();
  for (const name of exportedRuntimeNames(sourcePath, compilerOptions)) {
    if (ROUTE_METHODS.has(name as EntrypointMethod)) {
      methods.add(name as EntrypointMethod);
    }
  }
  if (methods.has("GET")) methods.add("HEAD");
  return [...methods].sort((left, right) => left.localeCompare(right));
}
