import { canonicalJsonBytes } from "@/lib/public-content/canonical";
import {
  snapshotPointerSchema,
  type CanonicalPublicState,
} from "@/lib/public-content/contracts";
import {
  CURRENT_POINTER_KEY,
  releaseManifestKey,
} from "@/lib/public-content/paths";
import { buildPublicRelease } from "@/lib/public-content/publisher/build-release";
import type { PublicEntityChange } from "@/lib/public-content/publisher/types";
import {
  PARITY_NOW_ISO,
  PARITY_STATE,
} from "@/tests/public-content/fixtures/parity-corpus";

type FixtureObject = {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly etag: string;
};

export type PublicSnapshotFixtureServer = {
  readonly baseUrl: string;
  readonly releaseId: string;
  readonly requestPaths: readonly string[];
  stop(): void;
};

export async function startPublicSnapshotFixture(options: {
  readonly port?: number;
} = {}): Promise<PublicSnapshotFixtureServer> {
  const { objects, releaseId } = await fixtureObjects(PARITY_STATE);
  const requestPaths: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: options.port ?? 0,
    fetch(request) {
      const url = new URL(request.url);
      requestPaths.push(url.pathname);
      const key = url.pathname.slice(1);
      const object = objects.get(key);
      if (!object) return new Response("not found", { status: 404 });
      return new Response(object.bytes.slice(), {
        headers: {
          "access-control-allow-origin": "*",
          "cache-control":
            key === CURRENT_POINTER_KEY
              ? "public, max-age=0, must-revalidate"
              : "public, max-age=31536000, immutable",
          "content-length": String(object.bytes.byteLength),
          "content-type": object.contentType,
          etag: object.etag,
        },
      });
    },
  });
  if (server.port === undefined) {
    server.stop(true);
    throw new Error("snapshot fixture did not bind a TCP port");
  }
  return {
    baseUrl: `http://127.0.0.1:${server.port}`,
    releaseId,
    requestPaths,
    stop: () => server.stop(true),
  };
}

async function fixtureObjects(
  state: CanonicalPublicState,
): Promise<{ objects: Map<string, FixtureObject>; releaseId: string }> {
  const release = await buildPublicRelease({
    previousManifest: null,
    sourceWatermark: 40,
    changes: allChanges(state),
    loadArtifact: async () => {
      throw new Error("fixture cannot load a prior artifact");
    },
  });
  const objects = new Map<string, FixtureObject>();
  for (const artifact of release.artifacts) {
    objects.set(artifact.descriptor.key, {
      bytes: artifact.bytes,
      contentType: artifact.descriptor.mediaType,
      etag: `"${artifact.descriptor.sha256}"`,
    });
  }
  const manifestKey = releaseManifestKey(release.releaseId);
  objects.set(manifestKey, {
    bytes: release.manifestBytes,
    contentType: "application/json",
    etag: `"${release.manifestSha256}"`,
  });
  const pointerBytes = canonicalJsonBytes(
    snapshotPointerSchema.parse({
      schemaVersion: 1,
      active: {
        releaseId: release.releaseId,
        manifestKey,
        manifestSha256: release.manifestSha256,
      },
      previous: null,
      publishedAt: PARITY_NOW_ISO,
      sourceWatermark: 40,
    }),
  );
  objects.set(CURRENT_POINTER_KEY, {
    bytes: pointerBytes,
    contentType: "application/json",
    etag: '"fixture-current"',
  });
  return { objects, releaseId: release.releaseId };
}

function allChanges(state: CanonicalPublicState): PublicEntityChange[] {
  return [
    ...state.sources.map((value) => ({
      entityType: "source" as const,
      entityKey: value.id,
      value,
    })),
    ...state.items.map((value) => ({
      entityType: "item" as const,
      entityKey: String(value.id),
      value,
    })),
    ...state.events.map((value) => ({
      entityType: "event" as const,
      entityKey: String(value.id),
      value,
    })),
    ...state.newsletters.map((value) => ({
      entityType: "newsletter" as const,
      entityKey: String(value.id),
      value,
    })),
    ...state.policies.map((value) => ({
      entityType: "policy" as const,
      entityKey: value.skillName,
      value,
    })),
  ];
}

if (import.meta.main) {
  const server = await startPublicSnapshotFixture({
    port: Number(Bun.env.PORT || 0),
  });
  process.stdout.write(
    `PUBLIC_SNAPSHOT_FIXTURE_READY ${JSON.stringify({
      baseUrl: server.baseUrl,
      releaseId: server.releaseId,
    })}\n`,
  );
  const stop = () => {
    server.stop();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  await new Promise(() => undefined);
}
