import { describe, expect, it } from "bun:test";
import { canonicalizeUrl } from "@/workers/normalizer/canonical";

describe("canonicalizeUrl", () => {
  it("lowercases host", () => {
    expect(canonicalizeUrl("https://EXAMPLE.com/path")).toBe(
      "https://example.com/path",
    );
  });

  it("strips utm_*", () => {
    expect(
      canonicalizeUrl(
        "https://example.com/path?utm_source=x&utm_medium=y&id=42",
      ),
    ).toBe("https://example.com/path?id=42");
  });

  it("strips fbclid / gclid / ref", () => {
    expect(canonicalizeUrl("https://example.com/?fbclid=abc&gclid=def&ref=x")).toBe(
      "https://example.com",
    );
  });

  it("drops fragment", () => {
    expect(canonicalizeUrl("https://example.com/path#section")).toBe(
      "https://example.com/path",
    );
  });

  it("strips trailing slash on bare-host URLs", () => {
    expect(canonicalizeUrl("https://example.com/")).toBe("https://example.com");
  });

  it("preserves path trailing slash", () => {
    expect(canonicalizeUrl("https://example.com/path/")).toBe(
      "https://example.com/path/",
    );
  });

  it("leaves invalid input untouched (trimmed)", () => {
    expect(canonicalizeUrl(" not a url ")).toBe("not a url");
  });
});
