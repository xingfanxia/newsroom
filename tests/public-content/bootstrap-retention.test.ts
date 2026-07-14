import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrapPublicSnapshot, type BootstrapSpendLedger, type BootstrapSpendReservation } from "@/lib/public-content/publisher/bootstrap";
import type {
  ImmutablePutInput,
  PointerCasInput,
  PublisherObjectStore,
  StoredPublisherObject,
} from "@/lib/public-content/publisher/object-store";
import { reconcilePublicSnapshot } from "@/lib/public-content/publisher/reconcile";
import { planPublicReleaseRetention } from "@/lib/public-content/publisher/retention";
import { persistPublicPublisherReceipt } from "@/lib/public-content/publisher/runtime";
import { CURRENT_POINTER_KEY } from "@/lib/public-content/paths";
import { manifestSchema, snapshotPointerSchema } from "@/lib/public-content/contracts";
import {
  FileBootstrapSpendLedger,
  parseBootstrapArguments,
} from "@/scripts/ops/bootstrap-public-snapshot";
import { canonicalState } from "./contract-fixtures";

const NOW = Date.parse("2026-07-14T12:00:00.000Z");
const DAY_MS = 86_400_000;
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

class MemoryStore implements PublisherObjectStore {
  readonly objects = new Map<string, StoredPublisherObject>();
  readonly events: string[] = [];
  #etag = 0;

  async readObject(key: string): Promise<StoredPublisherObject | null> {
    this.events.push(`read:${key}`);
    const object = this.objects.get(key);
    return object ? { ...object, bytes: object.bytes.slice() } : null;
  }

  async putImmutable(input: ImmutablePutInput) {
    this.events.push(`put:${input.key}`);
    const existing = this.objects.get(input.key);
    if (existing) return { status: "reused" as const, etag: existing.etag };
    const etag = this.nextEtag();
    this.objects.set(input.key, {
      bytes: input.bytes.slice(),
      etag,
      mediaType: input.mediaType,
      cacheControl: input.cacheControl ?? null,
    });
    return { status: "uploaded" as const, etag };
  }

  async compareAndSwapPointer(input: PointerCasInput) {
    this.events.push(`cas:${input.key}`);
    const current = this.objects.get(input.key);
    if ((current?.etag ?? null) !== input.expectedEtag) {
      return { status: "conflict" as const, etag: null };
    }
    const etag = this.nextEtag();
    this.objects.set(input.key, {
      bytes: input.bytes.slice(),
      etag,
      mediaType: input.mediaType,
      cacheControl: input.cacheControl ?? null,
    });
    return { status: "committed" as const, etag };
  }

  writeCount(): number {
    return this.events.filter(
      (event) => event.startsWith("put:") || event.startsWith("cas:"),
    ).length;
  }

  private nextEtag(): string {
    this.#etag += 1;
    return `"memory-${this.#etag}"`;
  }
}

class MemoryLedger implements BootstrapSpendLedger {
  readonly reservations: BootstrapSpendReservation[] = [];

  constructor(
    readonly events: string[],
    readonly allowed = true,
  ) {}

  async reserveBootstrap(
    reservation: BootstrapSpendReservation,
  ): Promise<boolean> {
    this.events.push("reserve");
    this.reservations.push(reservation);
    return this.allowed;
  }
}

describe("one-shot snapshot bootstrap", () => {
  test("reserves spend before writes and refuses a second release", async () => {
    const store = new MemoryStore();
    const ledger = new MemoryLedger(store.events);
    const first = await bootstrapPublicSnapshot({
      state: canonicalState(),
      sourceWatermark: 10,
      store,
      spendLedger: ledger,
      runId: "bootstrap-1",
      now: () => NOW,
    });
    expect(first.status).toBe("succeeded");
    expect(first.releaseId).not.toBeNull();
    expect(ledger.reservations).toHaveLength(1);
    expect(ledger.reservations[0]).toMatchObject({
      bootstrapSnapshots: 1,
      runId: "bootstrap-1",
    });
    expect(ledger.reservations[0]!.objectWrites).toBeLessThanOrEqual(500);
    expect(store.events.indexOf("reserve")).toBeLessThan(
      store.events.findIndex((event) => event.startsWith("put:")),
    );
    expect(store.objects.has(CURRENT_POINTER_KEY)).toBe(true);
    expect(await persistPublicPublisherReceipt(store, first)).toBe(
      "newsroom/v1/ops/runs/2026-07-14/bootstrap-1.json",
    );

    const writes = store.writeCount();
    const secondLedger = new MemoryLedger(store.events);
    const second = await bootstrapPublicSnapshot({
      state: canonicalState(),
      sourceWatermark: 10,
      store,
      spendLedger: secondLedger,
      runId: "bootstrap-2",
      now: () => NOW,
    });
    expect(second).toMatchObject({
      status: "failed",
      failureStage: "build_state",
      releaseId: null,
    });
    expect(secondLedger.reservations).toEqual([]);
    expect(store.writeCount()).toBe(writes);
  });

  test("a denied spend reservation performs no object writes", async () => {
    const store = new MemoryStore();
    const ledger = new MemoryLedger(store.events, false);
    const receipt = await bootstrapPublicSnapshot({
      state: canonicalState(),
      sourceWatermark: 10,
      store,
      spendLedger: ledger,
      runId: "bootstrap-denied",
      now: () => NOW,
    });
    expect(receipt.failureStage).toBe("build_state");
    expect(store.writeCount()).toBe(0);
  });

  test("the file ledger is write-ahead, single-use, and --apply gated", async () => {
    const root = await mkdtemp(join(tmpdir(), "newsroom-bootstrap-ledger-"));
    temporaryRoots.push(root);
    const path = join(root, "ledger.json");
    await writeFile(
      path,
      JSON.stringify({
        goalVersion: "r2-public-read-v1-ec57c55fe111",
        bootstrapSnapshots: { limit: 1, used: 0 },
        objectWritesPerRun: 500,
      }),
    );
    const ledger = new FileBootstrapSpendLedger(path);
    const reservation = {
      runId: "bootstrap-file",
      bootstrapSnapshots: 1 as const,
      objectWrites: 12,
    };
    expect(await ledger.reserveBootstrap(reservation)).toBe(true);
    expect(await ledger.reserveBootstrap(reservation)).toBe(false);
    expect(
      JSON.parse(await readFile(path, "utf8")).bootstrapSnapshots.used,
    ).toBe(1);
    expect(
      await readFile(`${path}.bootstrap-reserved`, "utf8"),
    ).toContain("bootstrap-file");

    expect(() => parseBootstrapArguments([])).toThrow(/--apply/);
    expect(
      parseBootstrapArguments([
        "--apply",
        "--state",
        "state.json",
        "--spend-ledger",
        "ledger.json",
        "--source-watermark",
        "42",
      ]),
    ).toEqual({
      statePath: "state.json",
      spendLedgerPath: "ledger.json",
      sourceWatermark: 42,
    });
  });
});

describe("bounded reconciliation and retention", () => {
  test("reconciliation reads only its cap and never repairs the pointer", async () => {
    const store = new MemoryStore();
    const ledger = new MemoryLedger(store.events);
    await bootstrapPublicSnapshot({
      state: canonicalState(),
      sourceWatermark: 10,
      store,
      spendLedger: ledger,
      runId: "bootstrap-reconcile",
      now: () => NOW,
    });
    store.events.length = 0;

    const healthy = await reconcilePublicSnapshot(store, { maxArtifacts: 2 });
    expect(healthy).toMatchObject({
      status: "succeeded",
      checkedArtifacts: 2,
      maxArtifacts: 2,
      truncated: true,
      objectReads: 4,
      pointerMutated: false,
      operatorPauseRequired: false,
    });
    expect(store.writeCount()).toBe(0);

    const pointer = snapshotPointerSchema.parse(
      JSON.parse(
        new TextDecoder().decode(store.objects.get(CURRENT_POINTER_KEY)!.bytes),
      ),
    );
    const manifest = manifestSchema.parse(
      JSON.parse(
        new TextDecoder().decode(
          store.objects.get(pointer.active.manifestKey)!.bytes,
        ),
      ),
    );
    const first = Object.entries(manifest.artifacts).sort(([left], [right]) =>
      left.localeCompare(right),
    )[0]!;
    store.objects.get(first[1].key)!.bytes = new TextEncoder().encode("{}\n");
    store.events.length = 0;
    const corrupt = await reconcilePublicSnapshot(store, { maxArtifacts: 2 });
    expect(corrupt.status).toBe("failed");
    expect(corrupt.operatorPauseRequired).toBe(true);
    expect(corrupt.pointerMutated).toBe(false);
    expect(store.writeCount()).toBe(0);
    await expect(
      reconcilePublicSnapshot(store, { maxArtifacts: 501 }),
    ).rejects.toThrow(/between 1 and 500/);
  });

  test("retains at least seven releases and thirty days with fail-closed pointer handling", () => {
    const releases = Array.from({ length: 45 }, (_, index) => ({
      releaseId: `r${index}`,
      publishedAt: new Date(NOW - (44 - index) * DAY_MS).toISOString(),
    }));
    const plan = planPublicReleaseRetention({
      releases,
      activeReleaseId: "r44",
      previousReleaseId: "r43",
      nowMs: NOW,
    });
    expect(plan.keepReleaseIds).toHaveLength(31);
    expect(plan.deleteReleaseIds).toHaveLength(14);
    expect(plan.keepReleaseIds).toContain("r44");
    expect(plan.keepReleaseIds).toContain("r43");
    expect(plan.pointerAction).toBe("none");

    const sparse = Array.from({ length: 10 }, (_, index) => ({
      releaseId: `s${index}`,
      publishedAt: new Date(NOW - index * 40 * DAY_MS).toISOString(),
    }));
    const sparsePlan = planPublicReleaseRetention({
      releases: sparse,
      activeReleaseId: "s0",
      previousReleaseId: "s1",
      nowMs: NOW,
    });
    expect(sparsePlan.keepReleaseIds).toHaveLength(7);
    expect(sparsePlan.deleteReleaseIds).toHaveLength(3);

    const paused = planPublicReleaseRetention({
      releases: sparse,
      activeReleaseId: "missing",
      previousReleaseId: "s1",
      pointerChangeRequested: true,
      nowMs: NOW,
    });
    expect(paused.operatorPauseRequired).toBe(true);
    expect(paused.pauseReasons).toEqual([
      "active_release_missing",
      "pointer_change_requested",
    ]);
    expect(paused.deleteReleaseIds).toEqual([]);
    expect(paused.keepReleaseIds).toHaveLength(10);
    expect(paused.pointerAction).toBe("none");
  });
});
