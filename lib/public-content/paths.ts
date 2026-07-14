const NAMESPACE = "newsroom/v1";
const LOWER_HEX_64 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const SAFE_LOGICAL_SEGMENT = /^[a-z0-9][a-z0-9._-]{0,127}$/;

export const CURRENT_POINTER_KEY = `${NAMESPACE}/current.json` as const;
const OBJECT_EXTENSIONS = ["json", "xml", "md"] as const;
export type ObjectExtension = (typeof OBJECT_EXTENSIONS)[number];

function rejectUnsafeText(value: string, label: string): void {
  if (
    value.length === 0 ||
    /[\\%?#\u0000-\u001f\u007f]/.test(value) ||
    value.startsWith("/")
  ) {
    throw new TypeError(`invalid ${label}`);
  }
}

function assertSafeId(value: string, label: string): void {
  rejectUnsafeText(value, label);
  if (!SAFE_ID.test(value) || value === "." || value === "..") {
    throw new TypeError(`invalid ${label}`);
  }
}

function assertSha256(value: string): void {
  if (!LOWER_HEX_64.test(value)) {
    throw new TypeError("invalid lowercase SHA-256");
  }
}

export function isSafeLogicalName(value: string): boolean {
  try {
    rejectUnsafeText(value, "logical name");
    const segments = value.split("/");
    return segments.every(
      (segment) =>
        segment !== "." &&
        segment !== ".." &&
        SAFE_LOGICAL_SEGMENT.test(segment),
    );
  } catch {
    return false;
  }
}

export function releaseManifestKey(releaseId: string): string {
  assertSafeId(releaseId, "release ID");
  return `${NAMESPACE}/releases/${releaseId}/manifest.json`;
}

export function objectKey(
  sha256: string,
  extension: ObjectExtension,
): string {
  assertSha256(sha256);
  if (!OBJECT_EXTENSIONS.includes(extension)) {
    throw new TypeError("invalid object extension");
  }
  return `${NAMESPACE}/objects/sha256/${sha256}.${extension}`;
}

export type ObjectKeyParts = {
  sha256: string;
  extension: ObjectExtension;
};

export function parseObjectKey(key: string): ObjectKeyParts | null {
  const match = key.match(
    /^newsroom\/v1\/objects\/sha256\/([a-f0-9]{64})\.(json|xml|md)$/,
  );
  if (!match) return null;
  return {
    sha256: match[1]!,
    extension: match[2] as ObjectExtension,
  };
}

function assertUtcDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError("invalid UTC date");
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new TypeError("invalid UTC date");
  }
}

export function runReceiptKey(date: string, runId: string): string {
  assertUtcDate(date);
  assertSafeId(runId, "run ID");
  return `${NAMESPACE}/ops/runs/${date}/${runId}.json`;
}
