import { z } from "zod";
import {
  isSafeLogicalName,
  parseObjectKey,
  releaseManifestKey,
} from "./paths";
import {
  nonNegativeSafeIntegerSchema,
  schemaVersionSchema,
  sha256Schema,
  utcIsoTimestampSchema,
} from "./contract-primitives";

const safeRuntimeIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]{0,127}$/);

const releaseRefSchema = z
  .strictObject({
    releaseId: safeRuntimeIdSchema,
    manifestKey: z.string(),
    manifestSha256: sha256Schema,
  })
  .superRefine((release, context) => {
    let expectedKey: string | null = null;
    try {
      expectedKey = releaseManifestKey(release.releaseId);
    } catch {
      // The base ID schema owns this issue. Refinements must remain total for
      // corrupt, untrusted pointer objects so safeParse never throws.
    }
    if (expectedKey !== null && release.manifestKey !== expectedKey) {
      context.addIssue({
        code: "custom",
        path: ["manifestKey"],
        message: "manifest key does not match release ID",
      });
    }
  });

export const snapshotPointerSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    active: releaseRefSchema,
    previous: releaseRefSchema.nullable(),
    publishedAt: utcIsoTimestampSchema,
    sourceWatermark: nonNegativeSafeIntegerSchema,
  })
  .superRefine((pointer, context) => {
    if (pointer.previous?.releaseId === pointer.active.releaseId) {
      context.addIssue({
        code: "custom",
        path: ["previous"],
        message: "previous release must differ from active release",
      });
    }
  });

const singletonShardSchema = z.strictObject({ kind: z.literal("singleton") });
const utcMonthShardSchema = z.strictObject({
  kind: z.literal("utc_month"),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
});
const idBucketShardSchema = z.strictObject({
  kind: z.literal("id_bucket"),
  bucket: z.string().regex(/^[a-f0-9]{2}$/),
});

const artifactShardSchema = z.discriminatedUnion("kind", [
  singletonShardSchema,
  utcMonthShardSchema,
  idBucketShardSchema,
]);

const artifactMediaTypeSchema = z.enum([
  "application/json",
  "application/rss+xml",
  "application/xml",
  "text/markdown",
]);

const EXTENSION_BY_MEDIA_TYPE = {
  "application/json": "json",
  "application/rss+xml": "xml",
  "application/xml": "xml",
  "text/markdown": "md",
} as const;

export const artifactDescriptorSchema = z
  .strictObject({
    key: z.string(),
    sha256: sha256Schema,
    byteLength: nonNegativeSafeIntegerSchema.positive(),
    mediaType: artifactMediaTypeSchema,
    encoding: z.literal("utf-8"),
    shard: artifactShardSchema,
  })
  .superRefine((artifact, context) => {
    const parts = parseObjectKey(artifact.key);
    if (!parts || parts.sha256 !== artifact.sha256) {
      context.addIssue({
        code: "custom",
        path: ["key"],
        message: "object key must contain descriptor SHA-256",
      });
      return;
    }
    if (parts.extension !== EXTENSION_BY_MEDIA_TYPE[artifact.mediaType]) {
      context.addIssue({
        code: "custom",
        path: ["mediaType"],
        message: "media type does not match object extension",
      });
    }
  });

const logicalNameSchema = z.string().refine(isSafeLogicalName, {
  message: "invalid artifact logical name",
});

export const manifestSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  releaseId: safeRuntimeIdSchema,
  sourceWatermark: nonNegativeSafeIntegerSchema,
  artifacts: z
    .record(logicalNameSchema, artifactDescriptorSchema)
    .refine((artifacts) => Object.keys(artifacts).length > 0, {
      message: "manifest must contain at least one artifact",
    }),
});

const failureStageSchema = z.enum([
  "read_outbox",
  "build_state",
  "derive",
  "upload_objects",
  "upload_manifest",
  "advance_pointer",
  "ack_outbox",
]);

export const runReceiptSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    runId: safeRuntimeIdSchema,
    mode: z.enum(["bootstrap", "incremental", "dry_run"]),
    status: z.enum(["succeeded", "failed", "noop"]),
    startedAt: utcIsoTimestampSchema,
    finishedAt: utcIsoTimestampSchema,
    durationMs: nonNegativeSafeIntegerSchema,
    sourceWatermark: z.strictObject({
      from: nonNegativeSafeIntegerSchema,
      to: nonNegativeSafeIntegerSchema,
    }),
    rows: z.strictObject({
      candidate: nonNegativeSafeIntegerSchema,
      deduped: nonNegativeSafeIntegerSchema,
      returned: nonNegativeSafeIntegerSchema,
      scannedRows: nonNegativeSafeIntegerSchema,
      scanMeasurementKind: z.literal("plan_upper_bound"),
      queryCount: nonNegativeSafeIntegerSchema,
      verifiedIndexes: z.array(z.string().min(1)),
    }),
    changed: z.strictObject({
      items: nonNegativeSafeIntegerSchema,
      events: nonNegativeSafeIntegerSchema,
      sources: nonNegativeSafeIntegerSchema,
      newsletters: nonNegativeSafeIntegerSchema,
      policies: nonNegativeSafeIntegerSchema,
      tombstones: nonNegativeSafeIntegerSchema,
    }),
    objects: z.strictObject({
      uploaded: nonNegativeSafeIntegerSchema,
      reused: nonNegativeSafeIntegerSchema,
      uploadedBytes: nonNegativeSafeIntegerSchema,
      reusedBytes: nonNegativeSafeIntegerSchema,
    }),
    releaseId: safeRuntimeIdSchema.nullable(),
    failureStage: failureStageSchema.nullable(),
  })
  .superRefine((receipt, context) => {
    if (receipt.finishedAt < receipt.startedAt) {
      context.addIssue({
        code: "custom",
        path: ["finishedAt"],
        message: "run cannot finish before it starts",
      });
    }
    if (receipt.sourceWatermark.to < receipt.sourceWatermark.from) {
      context.addIssue({
        code: "custom",
        path: ["sourceWatermark", "to"],
        message: "source watermark cannot move backwards",
      });
    }
    if (
      receipt.rows.scannedRows < receipt.rows.returned ||
      receipt.rows.scannedRows < receipt.rows.candidate ||
      receipt.rows.deduped > receipt.rows.candidate
    ) {
      context.addIssue({
        code: "custom",
        path: ["rows"],
        message: "row telemetry contradicts its proven upper bound",
      });
    }
    if (
      (receipt.rows.queryCount > 0 || receipt.rows.scannedRows > 0) &&
      receipt.rows.verifiedIndexes.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["rows", "verifiedIndexes"],
        message: "plan upper bound requires verified plan/index evidence",
      });
    }

    const dryRunWriteStages = new Set([
      "upload_objects",
      "upload_manifest",
      "advance_pointer",
      "ack_outbox",
    ]);
    if (
      receipt.mode === "dry_run" &&
      (receipt.releaseId !== null ||
        receipt.objects.uploaded > 0 ||
        receipt.objects.uploadedBytes > 0 ||
        (receipt.failureStage !== null &&
          dryRunWriteStages.has(receipt.failureStage)))
    ) {
      context.addIssue({
        code: "custom",
        message: "dry run cannot upload, commit, or acknowledge a release",
      });
    }

    const isDryRunSuccess =
      receipt.mode === "dry_run" && receipt.status === "succeeded";
    const isCommittedAckFailure =
      receipt.status === "failed" && receipt.failureStage === "ack_outbox";
    if (receipt.status === "noop") {
      if (receipt.failureStage !== null || receipt.releaseId !== null) {
        context.addIssue({ code: "custom", message: "noop cannot commit or fail" });
      }
    } else if (receipt.status === "succeeded") {
      if (receipt.failureStage !== null) {
        context.addIssue({ code: "custom", message: "success cannot have failure stage" });
      }
      if ((isDryRunSuccess && receipt.releaseId !== null) || (!isDryRunSuccess && receipt.releaseId === null)) {
        context.addIssue({ code: "custom", path: ["releaseId"], message: "release ID contradicts successful run mode" });
      }
    } else {
      if (receipt.failureStage === null) {
        context.addIssue({ code: "custom", path: ["failureStage"], message: "failed run requires a failure stage" });
      }
      if ((isCommittedAckFailure && receipt.releaseId === null) || (!isCommittedAckFailure && receipt.releaseId !== null)) {
        context.addIssue({ code: "custom", path: ["releaseId"], message: "release ID contradicts commit stage" });
      }
    }
  });
