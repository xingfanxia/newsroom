import { describe, expect, it } from "bun:test";
import { diffLines, narrativeDiff } from "@/lib/policy/diff";

describe("diffLines (structural)", () => {
  it("returns empty output when texts are identical", () => {
    const text = "line a\nline b\nline c";
    expect(diffLines(text, text)).toEqual([]);
  });

  it("detects pure additions at the end", () => {
    const out = diffLines("a\nb", "a\nb\nc");
    const kinds = out.map((l) => l.kind);
    expect(kinds).toContain("add");
    expect(out.find((l) => l.kind === "add")?.content).toBe("c");
  });

  it("detects a middle replacement as remove+add", () => {
    const out = diffLines("a\nb\nc", "a\nX\nc");
    const removes = out.filter((l) => l.kind === "remove").map((l) => l.content);
    const adds = out.filter((l) => l.kind === "add").map((l) => l.content);
    expect(removes).toContain("b");
    expect(adds).toContain("X");
  });

  it("collapses long unchanged stretches into a meta separator", () => {
    const base = Array.from({ length: 20 }, (_, i) => `line${i}`).join("\n");
    const proposed = base.replace("line0", "CHANGED").replace("line19", "DELTA");
    const out = diffLines(base, proposed, 1);
    const hasEllipsis = out.some((l) => l.kind === "meta" && l.content === "...");
    expect(hasEllipsis).toBe(true);
    // The far-apart changes should both be present.
    const adds = out.filter((l) => l.kind === "add").map((l) => l.content);
    expect(adds).toContain("CHANGED");
    expect(adds).toContain("DELTA");
  });
});

describe("narrativeDiff (editorial)", () => {
  it("maps changeSummary lines to add + didNotChange to remove", () => {
    const out = narrativeDiff(
      {
        changeSummary: "1. 新增 A\n2. 调整 B",
        didNotChange: [{ item: "加入 C", reason: "需要更多反馈" }],
      },
      { changes: "具体修改", heldBack: "未做的事" },
    );
    const metaHeaders = out.filter((l) => l.kind === "meta").map((l) => l.content);
    expect(metaHeaders).toContain("### 具体修改");
    expect(metaHeaders).toContain("### 未做的事");

    const adds = out.filter((l) => l.kind === "add").map((l) => l.content);
    expect(adds).toContain("1. 新增 A");
    expect(adds).toContain("2. 调整 B");

    const removes = out.filter((l) => l.kind === "remove").map((l) => l.content);
    expect(removes[0]).toContain("加入 C");
    expect(removes[0]).toContain("需要更多反馈");
  });

  it("omits the heldBack section when didNotChange is empty", () => {
    const out = narrativeDiff(
      { changeSummary: "1. ...", didNotChange: [] },
      { changes: "X", heldBack: "Y" },
    );
    const metaHeaders = out.filter((l) => l.kind === "meta").map((l) => l.content);
    expect(metaHeaders).toContain("### X");
    expect(metaHeaders).not.toContain("### Y");
  });
});
