import { describe, expect, test } from "bun:test";
import {
  artifactDescriptorSchema,
  manifestSchema,
  PUBLIC_NUMERIC_SHARD_COUNT,
  publicEntityShardLogicalName,
  runReceiptSchema,
  snapshotPointerSchema,
} from "@/lib/public-content/contracts";
import {
  CURRENT_POINTER_KEY,
  objectKey,
  releaseManifestKey,
  runReceiptKey,
} from "@/lib/public-content/paths";
import {
  artifactDescriptor,
  HASH_A,
  HASH_B,
  ISO,
  RELEASE_ID,
  runReceipt,
  snapshotManifest,
  snapshotPointer,
} from "./contract-fixtures";

describe("pointer, manifest, and receipt contracts", () => {
  test("bounds numeric entity shards below the bootstrap write cap", () => {
    expect(PUBLIC_NUMERIC_SHARD_COUNT).toBe(128);
    expect(publicEntityShardLogicalName("item", "1")).toBe("state/items/01");
    expect(publicEntityShardLogicalName("item", "17")).toBe("state/items/11");
    expect(publicEntityShardLogicalName("event", "128")).toBe(
      "state/events/00",
    );
  });

  test("reject unknown schema versions on otherwise valid records", () => {
    for (const { schema, valid } of [
      { schema: snapshotPointerSchema, valid: snapshotPointer() },
      { schema: manifestSchema, valid: snapshotManifest() },
      { schema: runReceiptSchema, valid: runReceipt() },
    ]) {
      expect(schema.safeParse({ ...valid, schemaVersion: 2 }).success).toBe(
        false,
      );
      expect(schema.safeParse({ ...valid, schemaVersion: "1" }).success).toBe(
        false,
      );
    }
  });

  test("require integrity refs for active and previous releases", () => {
    const pointer = snapshotPointer();
    expect(snapshotPointerSchema.parse(pointer)).toEqual(pointer);
    expect(
      snapshotPointerSchema.safeParse({
        ...pointer,
        previous: { ...pointer.previous, manifestSha256: undefined },
      }).success,
    ).toBe(false);
    expect(
      snapshotPointerSchema.safeParse({
        ...pointer,
        active: { ...pointer.active, manifestKey: CURRENT_POINTER_KEY },
      }).success,
    ).toBe(false);
    expect(() =>
      snapshotPointerSchema.safeParse({
        ...pointer,
        active: { ...pointer.active, releaseId: "../private" },
      }),
    ).not.toThrow();
    expect(
      snapshotPointerSchema.safeParse({
        ...pointer,
        previous: pointer.active,
      }).success,
    ).toBe(false);
  });

  test("bind artifact key, hash, extension, media type, and strict shard", () => {
    const descriptor = artifactDescriptor();
    expect(artifactDescriptorSchema.parse(descriptor)).toEqual(descriptor);
    expect(
      artifactDescriptorSchema.safeParse({ ...descriptor, sha256: HASH_B })
        .success,
    ).toBe(false);
    expect(
      artifactDescriptorSchema.safeParse({
        ...descriptor,
        shard: { kind: "utc_month", month: "2026-07", query: "private" },
      }).success,
    ).toBe(false);

    const manifest = snapshotManifest();
    expect(manifestSchema.parse(manifest)).toEqual(manifest);
    expect(
      manifestSchema.safeParse({ ...manifest, artifacts: {} }).success,
    ).toBe(false);
    expect(
      manifestSchema.safeParse({
        ...manifest,
        artifacts: { "../private": descriptor },
      }).success,
    ).toBe(false);
  });

  test("run receipts expose bounds, not errors, secrets, or token usage", () => {
    const receipt = runReceipt();
    expect(runReceiptSchema.parse(receipt).rows.scannedRows).toBe(16);
    expect(
      runReceiptSchema.safeParse({
        ...receipt,
        rows: { ...receipt.rows, scannedRows: undefined, scanned: 16 },
      }).success,
    ).toBe(false);
    expect(
      runReceiptSchema.safeParse({
        ...receipt,
        mode: "dry_run",
        releaseId: null,
        objects: {
          ...receipt.objects,
          uploaded: 0,
          uploadedBytes: 0,
        },
      }).success,
    ).toBe(true);
    expect(
      runReceiptSchema.safeParse({
        ...receipt,
        status: "failed",
        failureStage: "ack_outbox",
      }).success,
    ).toBe(true);
    for (const invalid of [
      { ...receipt, failureStage: "derive" },
      { ...receipt, releaseId: null },
      {
        ...receipt,
        startedAt: "2026-07-14T13:00:00.000Z",
        finishedAt: ISO,
      },
      { ...receipt, sourceWatermark: { from: 200, to: 123 } },
      {
        ...receipt,
        rows: { ...receipt.rows, scannedRows: 5, returned: 10 },
      },
      {
        ...receipt,
        rows: { ...receipt.rows, verifiedIndexes: [] },
      },
      {
        ...receipt,
        mode: "dry_run",
        status: "failed",
        failureStage: "ack_outbox",
      },
    ]) {
      expect(runReceiptSchema.safeParse(invalid).success).toBe(false);
    }
    expect(
      runReceiptSchema.safeParse({
        ...receipt,
        mode: "dry_run",
        status: "failed",
        failureStage: "derive",
        releaseId: null,
        objects: {
          ...receipt.objects,
          uploaded: 0,
          uploadedBytes: 0,
        },
      }).success,
    ).toBe(true);
    expect(
      runReceiptSchema.safeParse({
        ...receipt,
        status: "failed",
        failureStage: null,
        releaseId: null,
      }).success,
    ).toBe(false);
    for (const key of [
      "error",
      "stack",
      "secret",
      "tokens",
      "reasoningTokens",
      "usage",
    ]) {
      expect(
        runReceiptSchema.safeParse({ ...receipt, [key]: "PRIVATE" }).success,
        key,
      ).toBe(false);
    }
  });

  test("exports the frozen namespace builders", () => {
    expect(CURRENT_POINTER_KEY).toBe("newsroom/v1/current.json");
    expect(releaseManifestKey(RELEASE_ID)).toBe(
      `newsroom/v1/releases/${RELEASE_ID}/manifest.json`,
    );
    expect(objectKey(HASH_A, "xml")).toBe(
      `newsroom/v1/objects/sha256/${HASH_A}.xml`,
    );
    expect(runReceiptKey("2026-07-14", RELEASE_ID)).toBe(
      `newsroom/v1/ops/runs/2026-07-14/${RELEASE_ID}.json`,
    );
  });
});
