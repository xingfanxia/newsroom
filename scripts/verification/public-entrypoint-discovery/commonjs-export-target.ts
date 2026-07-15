import ts from "typescript";
import { unwrapExpression } from "./typescript-ast";

export type CommonJsExportTarget =
  | { readonly kind: "module-exports" }
  | { readonly kind: "property"; readonly name: string | null };

function propertyAccessTarget(
  expression: ts.PropertyAccessExpression,
  shadowed: ReadonlySet<string>,
): CommonJsExportTarget | null {
  const owner = unwrapExpression(expression.expression);
  if (ts.isIdentifier(owner) && owner.text === "exports" && !shadowed.has("exports")) {
    return { kind: "property", name: expression.name.text };
  }
  if (ts.isIdentifier(owner) && owner.text === "module" && expression.name.text === "exports" && !shadowed.has("module")) {
    return { kind: "module-exports" };
  }
  return commonJsExportTarget(owner, shadowed)?.kind === "module-exports"
    ? { kind: "property", name: expression.name.text }
    : null;
}

function elementAccessTarget(
  expression: ts.ElementAccessExpression,
  shadowed: ReadonlySet<string>,
): CommonJsExportTarget | null {
  if (!expression.argumentExpression) return null;
  const owner = unwrapExpression(expression.expression);
  const argument = unwrapExpression(expression.argumentExpression);
  const name = ts.isStringLiteralLike(argument) ? argument.text : null;
  if (ts.isIdentifier(owner) && owner.text === "exports" && !shadowed.has("exports")) {
    return { kind: "property", name };
  }
  if (ts.isIdentifier(owner) && owner.text === "module" && name === "exports" && !shadowed.has("module")) {
    return { kind: "module-exports" };
  }
  return commonJsExportTarget(owner, shadowed)?.kind === "module-exports"
    ? { kind: "property", name }
    : null;
}

export function commonJsExportTarget(
  expression: ts.Expression,
  shadowed: ReadonlySet<string>,
): CommonJsExportTarget | null {
  const current = unwrapExpression(expression);
  if (ts.isPropertyAccessExpression(current)) return propertyAccessTarget(current, shadowed);
  if (ts.isElementAccessExpression(current)) return elementAccessTarget(current, shadowed);
  return null;
}

export function isCommonJsContainer(
  expression: ts.Expression,
  shadowed: ReadonlySet<string>,
): boolean {
  const current = unwrapExpression(expression);
  return (
    (ts.isIdentifier(current) &&
      current.text === "exports" &&
      !shadowed.has("exports")) ||
    commonJsExportTarget(current, shadowed)?.kind === "module-exports"
  );
}
