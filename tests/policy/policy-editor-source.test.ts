import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const source = readFileSync(
  resolve(root, "components/admin/policy-editor.tsx"),
  "utf8",
);

describe("policy editor source wiring", () => {
  test("reuses the shared policy diff contract for edit previews", () => {
    expect(source).toContain("@/components/admin/diff-viewer");
    expect(source).toContain("@/lib/policy/diff");
    expect(source).toContain("diffLines(initialContent, content");
    expect(source).toContain("<DiffViewer lines={diff}");
  });

  test("protects dirty drafts when the browser tab closes", () => {
    expect(source).toContain("window.addEventListener(\"beforeunload\"");
    expect(source).toContain("window.removeEventListener(\"beforeunload\"");
    expect(source).toContain("event.preventDefault()");
    expect(source).toContain("event.returnValue = \"\"");
    expect(source).toContain("[dirty]");
  });
});
