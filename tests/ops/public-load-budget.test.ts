import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAnonymousLoad } from "@/scripts/ops/load-anonymous";
import {
  compareTursoLoadToControl,
  measureTursoWindow,
} from "@/scripts/ops/measure-turso-window";
import {
  assertPublicSpendReservation,
  PUBLIC_SPEND_CAPS,
  R2_PUBLIC_GOAL_VERSION,
  spendLedgerSchema,
  type PublicSpendLedger,
} from "@/scripts/ops/public-evidence";
import {
  assertPublicRuntimeCorpusComplete,
  buildAnonymousLoadPlan,
} from "@/scripts/verification/public-runtime-corpus";
import { verifyPublicCutoverEvidence } from "@/scripts/ops/verify-public-cutover";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("bounded anonymous load evidence", () => {
  test("builds deterministic 1x/10x/100x inventory sessions below the hard cap", () => {
    expect(assertPublicRuntimeCorpusComplete).not.toThrow();
    expect(buildAnonymousLoadPlan(1)).toHaveLength(71);
    expect(buildAnonymousLoadPlan(10)).toHaveLength(710);
    expect(buildAnonymousLoadPlan(100)).toHaveLength(7_100);
    expect(buildAnonymousLoadPlan(100).length).toBeLessThanOrEqual(
      PUBLIC_SPEND_CAPS.publicHttpRequests,
    );
    expect(() => buildAnonymousLoadPlan(2 as 1)).toThrow(
      "load multiplier must be 1, 10 or 100",
    );
  });

  test("rejects every over-cap spend ledger before execution", () => {
    for (const [key, value] of [
      ["r2ObjectWrites", 501],
      ["publicHttpRequests", 10_001],
      ["transferBytes", 1_073_741_825],
      ["bootstrapSnapshots", 2],
    ] as const) {
      expect(() =>
        spendLedgerSchema.parse({
          ...ledger(),
          planned: { ...ledger().planned, [key]: value },
        }),
      ).toThrow();
    }
    expect(() =>
      assertPublicSpendReservation(ledger(), {
        bootstrapSnapshots: 0,
        publicHttpRequests: 0,
        r2ObjectWrites: 0,
        transferBytes: 0,
        requiresTursoWindow: true,
      }),
    ).toThrow("named exact window");
  });

  test("refuses an under-reserved replay before the first HTTP request", async () => {
    let requests = 0;
    await expect(
      runAnonymousLoad({
        baseUrl: "http://127.0.0.1:43123",
        concurrency: 1,
        fetch: async () => {
          requests += 1;
          return new Response("unexpected");
        },
        ledger: ledger({ publicHttpRequests: 70 }),
        multiplier: 1,
        scenario: "warm",
      }),
    ).rejects.toThrow("publicHttpRequests");
    expect(requests).toBe(0);
  });

  test("executes one exact session and records response/byte totals", async () => {
    const plan = buildAnonymousLoadPlan(1);
    let index = 0;
    const receipt = await runAnonymousLoad({
      baseUrl: "http://127.0.0.1:43123",
      concurrency: 1,
      fetch: async (_input, init) => {
        const expected = plan[index++]!;
        if (expected.method === "RSC") {
          expect(new Headers(init?.headers).get("RSC")).toBe("1");
        }
        return new Response(expected.method === "HEAD" ? null : "ok", {
          status: expected.expectedStatus,
        });
      },
      ledger: ledger({
        publicHttpRequests: plan.length,
        transferBytes: 10_000,
      }),
      multiplier: 1,
      now: sequenceClock(),
      scenario: "warm",
    });
    expect(receipt.completedRequests).toBe(plan.length);
    expect(receipt.statusMismatchCount).toBe(0);
    expect(receipt.unexpected5xxCount).toBe(0);
    expect(receipt.receivedBytes).toBeGreaterThan(0);
  });
});

describe("exact Turso evidence windows", () => {
  test("compares equal load/control windows without hiding background reads", () => {
    const comparison = compareTursoLoadToControl(
      snapshot("load", "from", 1_000, 0),
      snapshot("load", "to", 1_100, 1),
      snapshot("control", "from", 2_000, 0),
      snapshot("control", "to", 2_100, 1),
    );
    expect(comparison.netDeltaRowsRead).toBe(0);
    expect(comparison.decoupled).toBeTrue();
  });

  test("requires equal named windows and grades the exact 24h target", () => {
    expect(() =>
      compareTursoLoadToControl(
        snapshot("load", "from", 1_000, 0),
        snapshot("load", "to", 1_100, 1),
        snapshot("control", "from", 2_000, 0),
        snapshot("control", "to", 2_100, 2),
      ),
    ).toThrow("equal and paired");
    const clean = measureTursoWindow(
      snapshot("clean", "from", 1_000_000, 0),
      snapshot("clean", "to", 1_100_000, 24),
    );
    expect(clean.durationHours).toBe(24);
    expect(clean.hardTargetMet).toBeTrue();
    expect(clean.preferredTargetMet).toBeTrue();
  });
});

describe("production cutover receipt aggregation", () => {
  test("accepts complete production receipts and rejects local cache evidence", () => {
    const directory = mkdtempSync(join(tmpdir(), "newsroom-cutover-"));
    temporaryDirectories.push(directory);
    const cache = {
      schemaVersion: 1,
      kind: "r2-cache",
      runId: "cache-production",
      capturedAt: "2026-07-14T12:00:00.000Z",
      origin: "https://news.ax0x.ai",
      pointerUrl: "https://content.ax0x.ai/newsroom/v1/current.json",
      immutableUrl: "https://content.ax0x.ai/newsroom/v1/objects/sha256/a.json",
      pointer: [
        cacheObservation("MISS", 0, "public, max-age=60", '"pointer"'),
        cacheObservation("HIT", 10, "public, max-age=60", '"pointer"'),
      ],
      immutable: [
        cacheObservation("MISS", 0, "public, max-age=31536000, immutable", '"object"'),
        cacheObservation("HIT", 10, "public, max-age=31536000, immutable", '"object"'),
      ],
      receivedBytes: 2,
    };
    writeJson(directory, "cache.json", cache);

    const loadSpecs = [
      ["load-warm", 1, "warm"],
      ["load-miss", 10, "cache-miss"],
      ["load-cold", 100, "cold-deploy"],
      ["load-missing", 1, "missing-object"],
    ] as const;
    for (const [runId, multiplier, scenario] of loadSpecs) {
      const plannedRequests = buildAnonymousLoadPlan(multiplier, scenario).length;
      writeJson(directory, `${runId}.json`, {
        schemaVersion: 1,
        kind: "anonymous-load",
        runId,
        scenario,
        multiplier,
        baseOrigin: "https://news.ax0x.ai",
        startedAt: "2026-07-14T12:00:00.000Z",
        finishedAt: "2026-07-14T12:01:00.000Z",
        plannedRequests,
        completedRequests: plannedRequests,
        receivedBytes: 1,
        statusMismatchCount: 0,
        unexpected5xxCount: 0,
        mismatches: [],
      });
      writeJson(directory, `${runId}-turso.json`, {
        schemaVersion: 1,
        kind: "turso-load-comparison",
        windowName: runId,
        database: "newsroom-v2",
        durationHours: 1,
        loadDeltaRowsRead: 100,
        controlDeltaRowsRead: 100,
        netDeltaRowsRead: 0,
        decoupled: true,
      });
    }
    writeJson(directory, "clean.json", measureTursoWindow(
      snapshot("clean", "from", 1_000_000, 0),
      snapshot("clean", "to", 1_100_000, 24),
    ));
    writeJson(directory, "publisher.json", publisherReceipt());
    writeJson(directory, "manifest.json", {
      schemaVersion: 1,
      cacheReceipt: "cache.json",
      loadReceipts: loadSpecs.map(([runId]) => `${runId}.json`),
      tursoLoadComparisons: loadSpecs.map(([runId]) => `${runId}-turso.json`),
      cleanTursoWindow: "clean.json",
      publisherReceipts: ["publisher.json"],
      publisherWindowHours: 24,
    });

    const verdict = verifyPublicCutoverEvidence(join(directory, "manifest.json"));
    expect(verdict.ac004).toBeTrue();
    expect(verdict.ac011).toBeTrue();
    expect(verdict.ac012).toBeTrue();

    writeJson(directory, "cache-local.json", {
      ...cache,
      pointerUrl: "http://127.0.0.1/current.json",
      immutableUrl: "http://127.0.0.1/object.json",
    });
    writeJson(directory, "manifest-local.json", {
      ...JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8")),
      cacheReceipt: "cache-local.json",
    });
    expect(
      verifyPublicCutoverEvidence(join(directory, "manifest-local.json")).ac004,
    ).toBeFalse();
  });
});

function ledger(
  planned: Partial<PublicSpendLedger["planned"]> = {},
): PublicSpendLedger {
  return spendLedgerSchema.parse({
    schemaVersion: 1,
    goalVersion: R2_PUBLIC_GOAL_VERSION,
    runId: "local-load-1",
    plannedAt: "2026-07-14T12:00:00.000Z",
    planned: {
      bootstrapSnapshots: 0,
      publicHttpRequests: 10_000,
      r2ObjectWrites: 0,
      transferBytes: 1_073_741_824,
      ...planned,
    },
    tursoWindowName: null,
  });
}

function snapshot(
  lane: "load" | "control" | "clean",
  phase: "from" | "to",
  rowsRead: number,
  hours: number,
) {
  return {
    schemaVersion: 1,
    kind: "turso-usage-snapshot",
    windowName: "load-window-1",
    lane,
    phase,
    database: "newsroom-v2",
    capturedAt: new Date(Date.parse("2026-07-14T00:00:00.000Z") + hours * 3_600_000).toISOString(),
    rowsRead,
    rowsWritten: 0,
  };
}

function sequenceClock(): () => number {
  let now = Date.parse("2026-07-14T12:00:00.000Z");
  return () => now++;
}

function cacheObservation(
  cfCacheStatus: string,
  age: number,
  cacheControl: string,
  etag: string,
) {
  return {
    age,
    cacheControl,
    cfCacheStatus,
    cors: "https://news.ax0x.ai",
    etag,
    status: 200,
  };
}

function publisherReceipt() {
  return {
    schemaVersion: 1,
    runId: "publisher-1",
    mode: "incremental",
    status: "noop",
    startedAt: "2026-07-14T12:00:00.000Z",
    finishedAt: "2026-07-14T12:00:01.000Z",
    durationMs: 1_000,
    sourceWatermark: { from: 1, to: 1 },
    rows: {
      candidate: 0,
      deduped: 0,
      returned: 0,
      scannedRows: 1_000,
      scanMeasurementKind: "plan_upper_bound",
      queryCount: 1,
      verifiedIndexes: ["public_outbox_id_idx"],
    },
    changed: {
      items: 0,
      events: 0,
      sources: 0,
      newsletters: 0,
      policies: 0,
      tombstones: 0,
    },
    objects: { uploaded: 0, reused: 0, uploadedBytes: 0, reusedBytes: 0 },
    releaseId: null,
    failureStage: null,
  };
}

function writeJson(directory: string, name: string, value: unknown): void {
  writeFileSync(join(directory, name), `${JSON.stringify(value)}\n`);
}
