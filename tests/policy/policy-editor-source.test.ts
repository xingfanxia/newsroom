import { describe, expect, test } from "bun:test";
import { readSource } from "@/tests/helpers/source";

const source = readSource("components/admin/policy-editor.tsx");

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

  test("uses inline confirmation panels instead of native confirm dialogs", () => {
    expect(source).not.toContain("confirm(");
    expect(source).toContain("confirmAction");
    expect(source).toContain("confirmPolicyCommit");
    expect(source).toContain("confirmPolicyDiscard");
    expect(source).toContain('role="alert"');
  });

  test("clears pending inline confirmations when the draft changes again", () => {
    expect(source).toContain("const editContent = (nextContent: string) => {");
    expect(source).toContain("const editReasoning = (nextReasoning: string) => {");
    expect(source).toContain("onChange={(e) => editContent(e.target.value)}");
    expect(source).toContain("onChange={(e) => editReasoning(e.target.value)}");
  });
});
