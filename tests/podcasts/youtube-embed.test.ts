import { describe, expect, it } from "bun:test";
import { extractYouTubeId } from "@/components/podcasts/youtube-embed";

describe("extractYouTubeId", () => {
  it("extracts ID from /watch?v=<id>", () => {
    expect(
      extractYouTubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    ).toBe("dQw4w9WgXcQ");
  });

  it("extracts ID from /watch?v=<id> with extra params", () => {
    expect(
      extractYouTubeId(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42&feature=shared",
      ),
    ).toBe("dQw4w9WgXcQ");
  });

  it("extracts ID from youtu.be short URLs", () => {
    expect(extractYouTubeId("https://youtu.be/dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ",
    );
    expect(extractYouTubeId("https://youtu.be/dQw4w9WgXcQ?t=10")).toBe(
      "dQw4w9WgXcQ",
    );
  });

  it("extracts ID from /shorts/<id>", () => {
    expect(extractYouTubeId("https://www.youtube.com/shorts/abc123XYZ")).toBe(
      "abc123XYZ",
    );
  });

  it("extracts ID from /embed/<id>", () => {
    expect(
      extractYouTubeId("https://www.youtube.com/embed/dQw4w9WgXcQ"),
    ).toBe("dQw4w9WgXcQ");
  });

  it("handles mobile youtube host", () => {
    expect(
      extractYouTubeId("https://m.youtube.com/watch?v=dQw4w9WgXcQ"),
    ).toBe("dQw4w9WgXcQ");
  });

  it("returns null for non-YouTube URLs", () => {
    expect(extractYouTubeId("https://spotify.com/episode/abc")).toBeNull();
    expect(extractYouTubeId("https://anchor.fm/episode/abc")).toBeNull();
  });

  it("returns null for invalid URLs", () => {
    expect(extractYouTubeId("not-a-url")).toBeNull();
    expect(extractYouTubeId("")).toBeNull();
  });

  it("returns null for YouTube URLs without a video id", () => {
    expect(extractYouTubeId("https://www.youtube.com/@channel")).toBeNull();
    expect(extractYouTubeId("https://www.youtube.com/watch")).toBeNull();
  });

  it("rejects IDs that are too short to be real", () => {
    expect(extractYouTubeId("https://youtu.be/ab")).toBeNull();
  });
});
