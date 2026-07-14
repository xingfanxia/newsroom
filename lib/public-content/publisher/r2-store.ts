import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import {
  IMMUTABLE_PUBLIC_CACHE_CONTROL,
  POINTER_PUBLIC_CACHE_CONTROL,
  type ImmutablePutInput,
  type PointerCasInput,
  type PublisherObjectStore,
  type StoredPublisherObject,
} from "./object-store";

export type R2PublisherStoreConfig = {
  bucket: string;
  accountId?: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export function createR2S3Client(
  config: R2PublisherStoreConfig,
): S3Client {
  const endpoint = r2Endpoint(config);
  const clientConfig = {
    region: "auto",
    endpoint,
    credentials: {
      accessKeyId: required(config.accessKeyId, "R2 access key ID"),
      secretAccessKey: required(
        config.secretAccessKey,
        "R2 secret access key",
      ),
    },
  } satisfies S3ClientConfig;
  return new S3Client(clientConfig);
}

export class R2PublisherObjectStore implements PublisherObjectStore {
  readonly #bucket: string;

  constructor(
    readonly client: S3Client,
    bucket: string,
  ) {
    this.#bucket = required(bucket, "R2 bucket");
  }

  static fromConfig(config: R2PublisherStoreConfig): R2PublisherObjectStore {
    return new R2PublisherObjectStore(createR2S3Client(config), config.bucket);
  }

  async readObject(key: string): Promise<StoredPublisherObject | null> {
    try {
      const output = await this.client.send(
        new GetObjectCommand({ Bucket: this.#bucket, Key: key }),
      );
      if (!output.Body || !output.ETag) {
        throw new Error(`R2 object missing body or ETag: ${key}`);
      }
      return {
        bytes: new Uint8Array(await output.Body.transformToByteArray()),
        etag: output.ETag,
        mediaType: output.ContentType ?? null,
        cacheControl: output.CacheControl ?? null,
      };
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async putImmutable(input: ImmutablePutInput) {
    try {
      const output = await this.client.send(
        new PutObjectCommand({
          Bucket: this.#bucket,
          Key: input.key,
          Body: input.bytes,
          ContentLength: input.bytes.byteLength,
          ContentType: input.mediaType,
          CacheControl:
            input.cacheControl ?? IMMUTABLE_PUBLIC_CACHE_CONTROL,
          IfNoneMatch: "*",
        }),
      );
      return { status: "uploaded" as const, etag: output.ETag ?? null };
    } catch (error) {
      if (isConditionalFailure(error)) {
        return { status: "reused" as const, etag: null };
      }
      throw error;
    }
  }

  async compareAndSwapPointer(input: PointerCasInput) {
    try {
      const output = await this.client.send(
        new PutObjectCommand({
          Bucket: this.#bucket,
          Key: input.key,
          Body: input.bytes,
          ContentLength: input.bytes.byteLength,
          ContentType: input.mediaType,
          CacheControl: input.cacheControl ?? POINTER_PUBLIC_CACHE_CONTROL,
          ...(input.expectedEtag === null
            ? { IfNoneMatch: "*" }
            : { IfMatch: input.expectedEtag }),
        }),
      );
      return { status: "committed" as const, etag: output.ETag ?? null };
    } catch (error) {
      if (isConditionalFailure(error)) {
        return { status: "conflict" as const, etag: null };
      }
      throw error;
    }
  }
}

function r2Endpoint(config: R2PublisherStoreConfig): string {
  const value =
    config.endpoint ??
    `https://${required(config.accountId ?? "", "R2 account ID")}.r2.cloudflarestorage.com`;
  const parsed = new URL(value);
  if (parsed.protocol !== "https:") {
    throw new TypeError("R2 endpoint must use HTTPS");
  }
  return parsed.toString().replace(/\/$/, "");
}

function required(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new TypeError(`${label} is required`);
  return trimmed;
}

function isMissing(error: unknown): boolean {
  return (
    errorStatus(error) === 404 ||
    errorName(error) === "NoSuchKey" ||
    errorName(error) === "NotFound"
  );
}

function isConditionalFailure(error: unknown): boolean {
  const status = errorStatus(error);
  const name = errorName(error);
  return (
    status === 409 ||
    status === 412 ||
    name === "PreconditionFailed" ||
    name === "ConditionalRequestConflict"
  );
}

function errorStatus(error: unknown): number | null {
  if (error === null || typeof error !== "object") return null;
  const metadata = (error as { $metadata?: { httpStatusCode?: unknown } })
    .$metadata;
  return typeof metadata?.httpStatusCode === "number"
    ? metadata.httpStatusCode
    : null;
}

function errorName(error: unknown): string | null {
  if (error === null || typeof error !== "object") return null;
  const value = (error as { name?: unknown }).name;
  return typeof value === "string" ? value : null;
}
