import { z } from "zod";
import {
  artifactDescriptorSchema,
  manifestSchema,
  snapshotPointerSchema,
  type CanonicalPublicState,
} from "@/lib/public-content/contracts";

export type SnapshotPointer = z.infer<typeof snapshotPointerSchema>;
export type SnapshotManifest = z.infer<typeof manifestSchema>;
export type SnapshotArtifactDescriptor = z.infer<
  typeof artifactDescriptorSchema
>;
export type SnapshotReleaseRef = SnapshotPointer["active"];

export type PublicSnapshotReadSource =
  | "active"
  | "previous"
  | "last-known-good";

export type ResolvedPublicRelease = {
  ref: SnapshotReleaseRef;
  manifest: SnapshotManifest;
  pointer: SnapshotPointer;
  source: PublicSnapshotReadSource;
};

export type PublicLogicalArtifact = {
  logicalName: string;
  descriptor: SnapshotArtifactDescriptor;
  bytes: Uint8Array;
  release: ResolvedPublicRelease;
};

export type PublicCanonicalStateResult = {
  state: CanonicalPublicState;
  release: ResolvedPublicRelease;
};

export class PublicSnapshotUnavailableError extends Error {
  readonly code = "PUBLIC_SNAPSHOT_UNAVAILABLE";
  readonly status = 503;

  constructor() {
    super("public snapshot is temporarily unavailable");
    this.name = "PublicSnapshotUnavailableError";
  }
}
