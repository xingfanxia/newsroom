import { describe, expect, it } from "bun:test";
import {
  cdxTimestampToMs,
  parseCdxResponse,
  sampleSnapshots,
  type CdxSnapshot,
} from "@/lib/backfill/wayback";

// Real shape returned by the Wayback CDX JSON endpoint: a 2D array where
// row[0] is the header. Status + digest lengths vary, so we model both.
const CDX_SAMPLE_JSON = JSON.stringify([
  ["urlkey", "timestamp", "original", "mimetype", "statuscode", "digest", "length"],
  [
    "com,openai)/news/rss.xml",
    "20260101005029",
    "https://openai.com/news/rss.xml",
    "text/xml",
    "200",
    "BKEMYIXOL35BFJQEJZ3KYEGABP6EBJP3",
    "76844",
  ],
  [
    "com,openai)/news/rss.xml",
    "20260102120000",
    "https://openai.com/news/rss.xml",
    "text/xml",
    "200",
    "NEW_DIGEST_SAMEFEED",
    "76850",
  ],
]);

describe("parseCdxResponse", () => {
  it("parses real CDX JSON shape", () => {
    const snaps = parseCdxResponse(CDX_SAMPLE_JSON);
    expect(snaps).toHaveLength(2);
    expect(snaps[0].timestamp).toBe("20260101005029");
    expect(snaps[0].originalUrl).toBe("https://openai.com/news/rss.xml");
    expect(snaps[0].status).toBe(200);
    expect(snaps[0].digest).toBe("BKEMYIXOL35BFJQEJZ3KYEGABP6EBJP3");
  });

  it("returns [] for empty body", () => {
    expect(parseCdxResponse("")).toEqual([]);
  });

  it("returns [] when only header is present (no matches)", () => {
    expect(
      parseCdxResponse(
        JSON.stringify([
          ["urlkey", "timestamp", "original", "mimetype", "statuscode", "digest", "length"],
        ]),
      ),
    ).toEqual([]);
  });

  it("throws on non-JSON body", () => {
    expect(() => parseCdxResponse("not valid json {{{")).toThrow();
  });
});

describe("cdxTimestampToMs", () => {
  it("parses a valid timestamp", () => {
    const ms = cdxTimestampToMs("20260101005029");
    expect(new Date(ms).toISOString()).toBe("2026-01-01T00:50:29.000Z");
  });

  it("returns NaN on malformed input", () => {
    expect(Number.isNaN(cdxTimestampToMs("not-a-ts"))).toBe(true);
    expect(Number.isNaN(cdxTimestampToMs("202601"))).toBe(true);
  });
});

describe("sampleSnapshots", () => {
  const makeSnaps = (...timestamps: string[]): CdxSnapshot[] =>
    timestamps.map((timestamp, i) => ({
      timestamp,
      originalUrl: "https://example.com/feed",
      status: 200,
      digest: `D${i}`,
    }));

  it("keeps only one snapshot per cadence window", () => {
    // Default cadence = 3.5d. Jan 2 is 1d after Jan 1 (skip). Jan 5 is
    // 4d after Jan 1 (keep). Jan 9 is 4d after Jan 5 (keep).
    const snaps = makeSnaps(
      "20260101000000",
      "20260102000000",
      "20260105000000",
      "20260109000000",
    );
    const kept = sampleSnapshots(snaps);
    expect(kept.map((s) => s.timestamp)).toEqual([
      "20260101000000",
      "20260105000000",
      "20260109000000",
    ]);
  });

  it("dedups by digest — identical content is skipped even if cadence elapsed", () => {
    const snaps: CdxSnapshot[] = [
      { timestamp: "20260101000000", originalUrl: "u", status: 200, digest: "A" },
      { timestamp: "20260108000000", originalUrl: "u", status: 200, digest: "A" }, // 7d later, same digest
      { timestamp: "20260115000000", originalUrl: "u", status: 200, digest: "B" },
    ];
    const kept = sampleSnapshots(snaps);
    expect(kept.map((s) => s.timestamp)).toEqual([
      "20260101000000",
      "20260115000000",
    ]);
  });

  it("honours custom cadence (daily)", () => {
    const snaps = makeSnaps(
      "20260101000000",
      "20260102000000",
      "20260103000000",
      "20260103120000",
    );
    const kept = sampleSnapshots(snaps, { cadenceMs: 24 * 60 * 60 * 1000 });
    expect(kept.map((s) => s.timestamp)).toEqual([
      "20260101000000",
      "20260102000000",
      "20260103000000",
    ]);
  });

  it("handles empty input", () => {
    expect(sampleSnapshots([])).toEqual([]);
  });

  it("sorts input before sampling (accepts unsorted CDX output)", () => {
    const snaps = makeSnaps(
      "20260108000000",
      "20260101000000",
      "20260115000000",
    );
    const kept = sampleSnapshots(snaps);
    // Sorted: Jan 1, Jan 8 (+7d), Jan 15 (+7d). Default cadence 3.5d, all kept.
    expect(kept.map((s) => s.timestamp)).toEqual([
      "20260101000000",
      "20260108000000",
      "20260115000000",
    ]);
  });

  it("discards malformed timestamps", () => {
    const snaps: CdxSnapshot[] = [
      { timestamp: "garbage", originalUrl: "u", status: 200, digest: "A" },
      { timestamp: "20260101000000", originalUrl: "u", status: 200, digest: "B" },
    ];
    const kept = sampleSnapshots(snaps);
    expect(kept).toHaveLength(1);
    expect(kept[0].timestamp).toBe("20260101000000");
  });
});
