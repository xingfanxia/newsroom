import ts from "typescript";
import {
  commonJsExportTarget,
  isCommonJsContainer,
} from "./commonjs-export-target";
import {
  collectBindingNames,
  hasDeclareModifier,
  staticPropertyName,
  topLevelBindingNames,
  unwrapExpression,
} from "./typescript-ast";

interface CommonJsScanContext {
  readonly names: Set<string>;
  readonly sourceFile: ts.SourceFile;
  readonly sourcePath: string;
}

type ScannableFunction =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration
  | ts.GetAccessorDeclaration
  | ts.SetAccessorDeclaration
  | ts.ConstructorDeclaration;

function commonJsObjectExportNames(
  object: ts.ObjectLiteralExpression,
  context: CommonJsScanContext,
): Set<string> {
  const names = new Set<string>();
  for (const property of object.properties) {
    if (ts.isSpreadAssignment(property)) {
      unsupported(context, "object spread");
    }
    const name = staticPropertyName(property.name);
    if (name === null) unsupported(context, "dynamic property");
    names.add(name);
  }
  return names;
}

function unsupported(context: CommonJsScanContext, detail: string): never {
  throw new Error(
    `Unsupported CommonJS export mutation in ${context.sourcePath}: ${detail}`,
  );
}

function addDirectStatementBindings(
  statements: readonly ts.Statement[],
  bindings: Set<string>,
): void {
  for (const statement of statements) {
    if (hasDeclareModifier(statement)) continue;
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        collectBindingNames(declaration.name, bindings);
      }
    } else if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      statement.name
    ) {
      bindings.add(statement.name.text);
    }
  }
}

function commonJsMutatorCall(
  context: CommonJsScanContext,
  call: ts.CallExpression,
  shadowed: ReadonlySet<string>,
): string | null {
  if (!call.arguments[0]) return null;
  const callee = unwrapExpression(call.expression);
  return ts.isPropertyAccessExpression(callee) &&
    ["assign", "defineProperties", "defineProperty", "set"].includes(
      callee.name.text,
    ) &&
    isCommonJsContainer(call.arguments[0], shadowed)
    ? `${callee.getText(context.sourceFile)} call`
    : null;
}

function isIgnoredCommonJsNode(node: ts.Node): boolean {
  return (
    ts.isTypeNode(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isImportDeclaration(node) ||
    ts.isImportEqualsDeclaration(node) ||
    ts.isExportDeclaration(node) ||
    hasDeclareModifier(node)
  );
}

function isScannableFunction(node: ts.Node): node is ScannableFunction {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isConstructorDeclaration(node)
  );
}

function scanCommonJsFunction(
  context: CommonJsScanContext,
  node: ScannableFunction,
  shadowed: ReadonlySet<string>,
): void {
  const functionShadowed = new Set(shadowed);
  if ("name" in node && node.name && ts.isIdentifier(node.name)) {
    functionShadowed.add(node.name.text);
  }
  for (const parameter of node.parameters) {
    collectBindingNames(parameter.name, functionShadowed);
  }
  for (const parameter of node.parameters) {
    if (parameter.initializer) {
      scanCommonJsNode(context, parameter.initializer, functionShadowed);
    }
  }
  if (node.body && ts.isBlock(node.body)) {
    addDirectStatementBindings(node.body.statements, functionShadowed);
  }
  if (node.body) scanCommonJsNode(context, node.body, functionShadowed);
}

function scanCommonJsBlock(
  context: CommonJsScanContext,
  block: ts.Block,
  shadowed: ReadonlySet<string>,
): void {
  const blockShadowed = new Set(shadowed);
  addDirectStatementBindings(block.statements, blockShadowed);
  for (const statement of block.statements) {
    scanCommonJsNode(context, statement, blockShadowed);
  }
}

function scanCommonJsCatchClause(
  context: CommonJsScanContext,
  clause: ts.CatchClause,
  shadowed: ReadonlySet<string>,
): void {
  const catchShadowed = new Set(shadowed);
  if (clause.variableDeclaration) {
    collectBindingNames(clause.variableDeclaration.name, catchShadowed);
  }
  scanCommonJsNode(context, clause.block, catchShadowed);
}

function assertSupportedCommonJsReference(
  context: CommonJsScanContext,
  node: ts.Node,
  shadowed: ReadonlySet<string>,
): void {
  if (ts.isCallExpression(node)) {
    const detail = commonJsMutatorCall(context, node, shadowed);
    if (detail) unsupported(context, detail);
  }
  if (
    ts.isIdentifier(node) &&
    node.text === "exports" &&
    !shadowed.has("exports")
  ) {
    unsupported(context, "indirect exports reference");
  }
  if (
    ts.isIdentifier(node) &&
    node.text === "module" &&
    !shadowed.has("module")
  ) {
    unsupported(context, "indirect module reference");
  }
  if (
    (ts.isPropertyAccessExpression(node) ||
      ts.isElementAccessExpression(node)) &&
    commonJsExportTarget(node, shadowed)
  ) {
    unsupported(context, "indirect module.exports reference");
  }
}

function scanCommonJsExpression(
  context: CommonJsScanContext,
  expression: ts.Expression,
  shadowed: ReadonlySet<string>,
  allowStaticAssignment: boolean,
): void {
  const current = unwrapExpression(expression);
  if (ts.isBinaryExpression(current)) {
    const target = commonJsExportTarget(current.left, shadowed);
    if (target) {
      if (!allowStaticAssignment) {
        unsupported(context, "nested or conditional assignment");
      }
      if (current.operatorToken.kind !== ts.SyntaxKind.EqualsToken) {
        unsupported(context, "compound assignment");
      }
      if (target.kind === "property") {
        if (target.name === null) unsupported(context, "dynamic property assignment");
        context.names.add(target.name);
        scanCommonJsNode(context, current.right, shadowed);
        return;
      }
      const value = unwrapExpression(current.right);
      if (!ts.isObjectLiteralExpression(value)) {
        unsupported(context, "non-object module.exports assignment");
      }
      for (const name of commonJsObjectExportNames(value, context)) {
        context.names.add(name);
      }
      scanCommonJsNode(context, value, shadowed);
      return;
    }
  }
  assertSupportedCommonJsReference(context, current, shadowed);
  ts.forEachChild(current, (child) =>
    scanCommonJsNode(context, child, shadowed),
  );
}

function scanCommonJsNode(
  context: CommonJsScanContext,
  node: ts.Node,
  shadowed: ReadonlySet<string>,
): void {
  if (isIgnoredCommonJsNode(node)) return;
  if (isScannableFunction(node)) {
    scanCommonJsFunction(context, node, shadowed);
    return;
  }
  if (ts.isBlock(node)) {
    scanCommonJsBlock(context, node, shadowed);
    return;
  }
  if (ts.isCatchClause(node)) {
    scanCommonJsCatchClause(context, node, shadowed);
    return;
  }
  if (ts.isBinaryExpression(node)) {
    scanCommonJsExpression(context, node, shadowed, false);
    return;
  }
  assertSupportedCommonJsReference(context, node, shadowed);
  ts.forEachChild(node, (child) =>
    scanCommonJsNode(context, child, shadowed),
  );
}

export function commonJsRuntimeNames(
  sourceFile: ts.SourceFile,
  sourcePath: string,
): Set<string> {
  const context: CommonJsScanContext = {
    names: new Set<string>(),
    sourceFile,
    sourcePath,
  };
  const topLevelShadowed = topLevelBindingNames(sourceFile);
  for (const statement of sourceFile.statements) {
    if (ts.isExpressionStatement(statement)) {
      scanCommonJsExpression(context, statement.expression, topLevelShadowed, true);
    } else {
      scanCommonJsNode(context, statement, topLevelShadowed);
    }
  }
  return context.names;
}
