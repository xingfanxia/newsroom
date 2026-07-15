import { describe, expect, test } from "bun:test";
import {
  GetObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import {
  IMMUTABLE_PUBLIC_CACHE_CONTROL,
  POINTER_PUBLIC_CACHE_CONTROL,
} from "@/lib/public-content/publisher/object-store";
import {
  createR2S3Client,
  R2PublisherObjectStore,
} from "@/lib/public-content/publisher/r2-store";

class FakeS3 {
  readonly commands: unknown[] = [];
  readonly outcomes: unknown[] = [];

  async send(command: unknown): Promise<unknown> {
    this.commands.push(command);
    const outcome = this.outcomes.shift();
    if (outcome instanceof Error) throw outcome;
    return outcome;
  }

  client(): S3Client {
    return this as unknown as S3Client;
  }
}

function serviceError(status: number, name: string): Error {
  return Object.assign(new Error(name), {
    name,
    $metadata: { httpStatusCode: status },
  });
}

describe("R2 publisher object store", () => {
  test("constructs the S3 client with R2's auto region and HTTPS endpoint", async () => {
    const client = createR2S3Client({
      accountId: "account-id",
      bucket: "newsroom",
      accessKeyId: "access-key",
      secretAccessKey: "secret-key",
    });
    expect(await client.config.region()).toBe("auto");
    expect(client.config.endpoint).toBeDefined();
    expect(await client.config.endpoint!()).toMatchObject({
      protocol: "https:",
      hostname: "account-id.r2.cloudflarestorage.com",
    });
    client.destroy();

    expect(() =>
      createR2S3Client({
        endpoint: "http://example.com",
        bucket: "newsroom",
        accessKeyId: "access-key",
        secretAccessKey: "secret-key",
      }),
    ).toThrow(/HTTPS/);
  });

  test("reads bytes and treats only a real missing-object response as null", async () => {
    const fake = new FakeS3();
    fake.outcomes.push(
      {
        Body: {
          transformToByteArray: async () => Uint8Array.from([1, 2, 3]),
        },
        ETag: '"etag-a"',
        ContentType: "application/json",
        CacheControl: IMMUTABLE_PUBLIC_CACHE_CONTROL,
      },
      serviceError(404, "NoSuchKey"),
      serviceError(500, "InternalError"),
    );
    const store = new R2PublisherObjectStore(fake.client(), "newsroom");

    expect(await store.readObject("object.json")).toEqual({
      bytes: Uint8Array.from([1, 2, 3]),
      etag: '"etag-a"',
      mediaType: "application/json",
      cacheControl: IMMUTABLE_PUBLIC_CACHE_CONTROL,
    });
    expect(fake.commands[0]).toBeInstanceOf(GetObjectCommand);
    expect(await store.readObject("missing.json")).toBeNull();
    await expect(store.readObject("broken.json")).rejects.toThrow(
      /InternalError/,
    );
  });

  test("uses conditional immutable puts and ETag pointer CAS", async () => {
    const fake = new FakeS3();
    fake.outcomes.push(
      { ETag: '"new-object"' },
      serviceError(412, "PreconditionFailed"),
      { ETag: '"new-pointer"' },
      serviceError(412, "PreconditionFailed"),
      { ETag: '"initial-pointer"' },
    );
    const store = new R2PublisherObjectStore(fake.client(), "newsroom");
    const bytes = Uint8Array.from([4, 5, 6]);

    expect(
      await store.putImmutable({
        key: "immutable.json",
        bytes,
        mediaType: "application/json",
      }),
    ).toEqual({ status: "uploaded", etag: '"new-object"' });
    expect(
      await store.putImmutable({
        key: "immutable.json",
        bytes,
        mediaType: "application/json",
      }),
    ).toEqual({ status: "reused", etag: null });
    expect(
      await store.compareAndSwapPointer({
        key: "current.json",
        expectedEtag: '"old-pointer"',
        bytes,
        mediaType: "application/json",
      }),
    ).toEqual({ status: "committed", etag: '"new-pointer"' });
    expect(
      await store.compareAndSwapPointer({
        key: "current.json",
        expectedEtag: '"stale-pointer"',
        bytes,
        mediaType: "application/json",
      }),
    ).toEqual({ status: "conflict", etag: null });
    expect(
      await store.compareAndSwapPointer({
        key: "current.json",
        expectedEtag: null,
        bytes,
        mediaType: "application/json",
      }),
    ).toEqual({ status: "committed", etag: '"initial-pointer"' });

    const inputs = fake.commands.map(
      (command) => (command as PutObjectCommand).input,
    );
    expect(inputs[0]).toMatchObject({
      Bucket: "newsroom",
      Key: "immutable.json",
      IfNoneMatch: "*",
      CacheControl: IMMUTABLE_PUBLIC_CACHE_CONTROL,
    });
    expect(inputs[2]).toMatchObject({
      IfMatch: '"old-pointer"',
      CacheControl: POINTER_PUBLIC_CACHE_CONTROL,
    });
    expect(inputs[2]?.IfNoneMatch).toBeUndefined();
    expect(inputs[4]).toMatchObject({ IfNoneMatch: "*" });
    expect(inputs[4]?.IfMatch).toBeUndefined();
  });
});
