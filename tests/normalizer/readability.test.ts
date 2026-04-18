import { describe, expect, it } from "bun:test";
import { stripHtml } from "@/workers/normalizer/readability";

describe("stripHtml", () => {
  it("returns plain text unchanged (tweets, snippets)", () => {
    expect(stripHtml("Anthropic 发布了 Claude Design")).toBe(
      "Anthropic 发布了 Claude Design",
    );
  });

  it("preserves newlines in plain text", () => {
    const input = "line one\n\nline two\nline three";
    expect(stripHtml(input)).toBe(input);
  });

  it("strips HTML tags while preserving inline text", () => {
    expect(stripHtml("<p>Hello <strong>world</strong></p>")).toBe("Hello world");
  });

  it("handles multi-paragraph HTML", () => {
    const input = "<p>First paragraph.</p><p>Second paragraph.</p>";
    const out = stripHtml(input);
    expect(out).toContain("First paragraph");
    expect(out).toContain("Second paragraph");
    expect(out).not.toContain("<");
  });

  it("returns empty string for empty / whitespace input", () => {
    expect(stripHtml("")).toBe("");
    expect(stripHtml("   ")).toBe("");
  });

  it("preserves Unicode cleanly (the tweet failure mode before the fix)", () => {
    const tweet =
      "经过试用，Claude Design 将会是跟 Claude Code 一样重要的产品，千万别低估它的潜力。";
    expect(stripHtml(tweet)).toBe(tweet);
  });

  it("regex-strips malformed HTML as a last resort", () => {
    // Malformed enough that parseHTML can't make sense of it, but regex still salvages the text
    expect(stripHtml("<not-a-real-tag>text</>")).toContain("text");
  });
});
