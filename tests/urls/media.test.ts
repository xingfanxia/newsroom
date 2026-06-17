import { describe, expect, test } from "bun:test";
import {
  extractYouTubeId,
  isYouTubeVideoUrl,
} from "@/lib/urls/media";

describe("media URL helpers", () => {
  test("extracts YouTube video ids from supported URL shapes", () => {
    expect(
      extractYouTubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    ).toBe("dQw4w9WgXcQ");
    expect(
      extractYouTubeId(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42&feature=shared",
      ),
    ).toBe("dQw4w9WgXcQ");
    expect(extractYouTubeId("https://youtu.be/dQw4w9WgXcQ?t=10")).toBe(
      "dQw4w9WgXcQ",
    );
    expect(extractYouTubeId("https://www.youtube.com/shorts/abc123XYZ")).toBe(
      "abc123XYZ",
    );
    expect(
      extractYouTubeId("https://www.youtube.com/embed/dQw4w9WgXcQ"),
    ).toBe("dQw4w9WgXcQ");
    expect(
      extractYouTubeId("https://m.youtube.com/watch?v=dQw4w9WgXcQ"),
    ).toBe("dQw4w9WgXcQ");
  });

  test("rejects non-video and malformed YouTube URLs", () => {
    expect(extractYouTubeId("https://www.youtube.com/@channel")).toBeNull();
    expect(extractYouTubeId("https://www.youtube.com/watch")).toBeNull();
    expect(extractYouTubeId("https://youtu.be/ab")).toBeNull();
    expect(extractYouTubeId("https://spotify.com/episode/abc")).toBeNull();
    expect(extractYouTubeId("not-a-url")).toBeNull();
    expect(extractYouTubeId("")).toBeNull();
  });

  test("classifies only valid YouTube videos as transcript-owned", () => {
    expect(isYouTubeVideoUrl("https://youtu.be/dQw4w9WgXcQ")).toBe(true);
    expect(isYouTubeVideoUrl("https://www.youtube.com/@channel")).toBe(false);
  });
});
