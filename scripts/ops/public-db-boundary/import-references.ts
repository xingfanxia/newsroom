import ts from "typescript";

export interface ImportReference {
  readonly literal: boolean;
  readonly runtime: boolean;
  readonly specifier: string | null;
}

type ScannableFunction =
  | ts.ArrowFunction
  | ts.ConstructorDeclaration
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.GetAccessorDeclaration
  | ts.MethodDeclaration
  | ts.SetAccessorDeclaration;

function hasDeclareModifier(node: ts.Node): boolean {
  return Boolean(
    ts.canHaveModifiers(node) &&
      ts.getModifiers(node)?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword,
      ),
  );
}

function collectBindingNames(name: ts.BindingName, names: Set<string>): void {
  if (ts.isIdentifier(name)) {
    names.add(name.text);
    return;
  }
  for (const element of name.elements) {
    if (!ts.isOmittedExpression(element)) collectBindingNames(element.name, names);
  }
}

function addImportBindings(
  statement: ts.ImportDeclaration,
  bindings: Set<string>,
): void {
  const clause = statement.importClause;
  if (!clause || clause.isTypeOnly) return;
  if (clause.name) bindings.add(clause.name.text);
  const named = clause.namedBindings;
  if (named && ts.isNamespaceImport(named)) {
    bindings.add(named.name.text);
  } else if (named) {
    for (const element of named.elements) {
      if (!element.isTypeOnly) bindings.add(element.name.text);
    }
  }
}

function addStatementBindings(
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
        ts.isEnumDeclaration(statement) ||
        ts.isModuleDeclaration(statement)) &&
      statement.name &&
      ts.isIdentifier(statement.name)
    ) {
      bindings.add(statement.name.text);
    } else if (ts.isImportDeclaration(statement)) {
      addImportBindings(statement, bindings);
    } else if (ts.isImportEqualsDeclaration(statement) && !statement.isTypeOnly) {
      bindings.add(statement.name.text);
    }
  }
}

function importDeclarationRuns(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (!clause) return true;
  if (clause.isTypeOnly) return false;
  if (clause.name) return true;
  const named = clause.namedBindings;
  if (!named || ts.isNamespaceImport(named)) return true;
  return named.elements.length === 0 || named.elements.some((item) => !item.isTypeOnly);
}

function exportDeclarationRuns(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) return false;
  if (!node.exportClause || ts.isNamespaceExport(node.exportClause)) return true;
  return (
    node.exportClause.elements.length === 0 ||
    node.exportClause.elements.some((item) => !item.isTypeOnly)
  );
}

function isGlobalModuleMember(
  expression: ts.Expression,
  member: "exports" | "require",
  shadowed: ReadonlySet<string>,
): boolean {
  if (shadowed.has("module")) return false;
  if (ts.isPropertyAccessExpression(expression)) {
    return (
      ts.isIdentifier(expression.expression) &&
      expression.expression.text === "module" &&
      expression.name.text === member
    );
  }
  return (
    ts.isElementAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === "module" &&
    expression.argumentExpression !== undefined &&
    ts.isStringLiteralLike(expression.argumentExpression) &&
    expression.argumentExpression.text === member
  );
}

function isIdentifierReference(node: ts.Identifier): boolean {
  if (ts.isPartOfTypeNode(node)) return false;
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isBindingElement(parent) && (parent.name === node || parent.propertyName === node)) {
    return false;
  }
  const namedParent = parent as ts.Node & { readonly name?: ts.Node };
  if (namedParent.name === node) {
    return ts.isShorthandPropertyAssignment(parent);
  }
  return !(
    (ts.isLabeledStatement(parent) ||
      ts.isBreakStatement(parent) ||
      ts.isContinueStatement(parent)) &&
    parent.label === node
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

class ImportReferenceCollector {
  readonly references: ImportReference[] = [];

  collect(sourceFile: ts.SourceFile): ImportReference[] {
    const shadowed = new Set<string>();
    addStatementBindings(sourceFile.statements, shadowed);
    for (const statement of sourceFile.statements) this.visit(statement, shadowed);
    return this.references;
  }

  private addLiteral(node: ts.Node | undefined, runtime: boolean): void {
    if (!node) return;
    const expression = ts.isLiteralTypeNode(node) ? node.literal : node;
    this.references.push(
      ts.isStringLiteralLike(expression)
        ? { literal: true, runtime, specifier: expression.text }
        : { literal: false, runtime, specifier: null },
    );
  }

  private visitFunction(node: ScannableFunction, shadowed: ReadonlySet<string>): void {
    const parameterScope = new Set(shadowed);
    if (node.name && ts.isIdentifier(node.name)) parameterScope.add(node.name.text);
    for (const parameter of node.parameters) {
      collectBindingNames(parameter.name, parameterScope);
    }
    for (const parameter of node.parameters) {
      if (parameter.initializer) this.visit(parameter.initializer, parameterScope);
    }
    if (!node.body) return;
    const bodyScope = new Set(parameterScope);
    if (ts.isBlock(node.body)) addStatementBindings(node.body.statements, bodyScope);
    this.visit(node.body, bodyScope);
  }

  private visitCall(node: ts.CallExpression, shadowed: ReadonlySet<string>): void {
    if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      this.addLiteral(node.arguments[0], true);
    } else if (
      ts.isIdentifier(node.expression) &&
      node.expression.text === "require" &&
      !shadowed.has("require")
    ) {
      this.addLiteral(node.arguments[0], true);
    } else if (isGlobalModuleMember(node.expression, "require", shadowed)) {
      this.addLiteral(node.arguments[0], true);
    }
  }

  private visitIndirectLoader(node: ts.Node, shadowed: ReadonlySet<string>): void {
    if (
      ts.isIdentifier(node) &&
      node.text === "require" &&
      !shadowed.has("require") &&
      isIdentifierReference(node) &&
      !(ts.isCallExpression(node.parent) && node.parent.expression === node)
    ) {
      this.references.push({ literal: false, runtime: true, specifier: null });
    }
    if (
      ts.isExpression(node) &&
      isGlobalModuleMember(node, "require", shadowed) &&
      !(ts.isCallExpression(node.parent) && node.parent.expression === node)
    ) {
      this.references.push({ literal: false, runtime: true, specifier: null });
    }
  }

  private visitIndirectModule(node: ts.Node, shadowed: ReadonlySet<string>): void {
    if (
      !ts.isIdentifier(node) ||
      node.text !== "module" ||
      shadowed.has("module") ||
      !isIdentifierReference(node)
    ) return;
    const parent = node.parent;
    if (
      (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
      parent.expression === node &&
      (isGlobalModuleMember(parent, "require", shadowed) ||
        isGlobalModuleMember(parent, "exports", shadowed))
    ) return;
    this.references.push({ literal: false, runtime: true, specifier: null });
  }

  private visit(node: ts.Node, shadowed: ReadonlySet<string>): void {
    if (ts.isImportDeclaration(node)) {
      this.addLiteral(node.moduleSpecifier, importDeclarationRuns(node));
      return;
    }
    if (ts.isExportDeclaration(node)) {
      this.addLiteral(node.moduleSpecifier, exportDeclarationRuns(node));
      return;
    }
    if (isScannableFunction(node)) return this.visitFunction(node, shadowed);
    if (ts.isBlock(node)) return this.visitBlock(node, shadowed);
    if (ts.isCatchClause(node)) return this.visitCatch(node, shadowed);
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      this.addLiteral(node.moduleReference.expression, !node.isTypeOnly);
      return;
    }
    if (ts.isImportTypeNode(node)) {
      this.addLiteral(node.argument, false);
      return;
    }
    if (ts.isCallExpression(node)) this.visitCall(node, shadowed);
    this.visitIndirectLoader(node, shadowed);
    this.visitIndirectModule(node, shadowed);
    ts.forEachChild(node, (child) => this.visit(child, shadowed));
  }

  private visitBlock(node: ts.Block, shadowed: ReadonlySet<string>): void {
    const blockScope = new Set(shadowed);
    addStatementBindings(node.statements, blockScope);
    for (const statement of node.statements) this.visit(statement, blockScope);
  }

  private visitCatch(node: ts.CatchClause, shadowed: ReadonlySet<string>): void {
    const catchScope = new Set(shadowed);
    if (node.variableDeclaration) collectBindingNames(node.variableDeclaration.name, catchScope);
    this.visit(node.block, catchScope);
  }
}

export function collectImportReferences(sourceFile: ts.SourceFile): ImportReference[] {
  return new ImportReferenceCollector().collect(sourceFile);
}
