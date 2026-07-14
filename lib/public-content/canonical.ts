import {
  canonicalStateSchema,
  type CanonicalPublicState,
} from "./contracts";

const encoder = new TextEncoder();

type CanonicalScalar = null | boolean | number | string;

function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function primitiveJson(value: CanonicalScalar): string {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new TypeError("unsupported canonical value");
  return encoded;
}

function assertDataDescriptor(
  descriptor: PropertyDescriptor,
  path: string,
): asserts descriptor is PropertyDescriptor & { value: unknown } {
  if ("get" in descriptor || "set" in descriptor) {
    throw new TypeError(`canonical value contains accessor at ${path}`);
  }
  if (!("value" in descriptor)) {
    throw new TypeError(`canonical value lacks data at ${path}`);
  }
}

function emitArray(
  value: unknown[],
  active: WeakSet<object>,
  path: string,
): string {
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError(`canonical array has custom prototype at ${path}`);
  }
  const names = Object.getOwnPropertyNames(value);
  if (names.length !== value.length + 1) {
    throw new TypeError(`canonical array is sparse or has extra properties at ${path}`);
  }
  const allowed = new Set(["length"]);
  const parts: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const key = String(index);
    allowed.add(key);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) throw new TypeError(`canonical array is sparse at ${path}`);
    assertDataDescriptor(descriptor, `${path}[${index}]`);
    parts.push(emitCanonical(descriptor.value, active, `${path}[${index}]`));
  }
  if (names.some((name) => !allowed.has(name))) {
    throw new TypeError(`canonical array has extra properties at ${path}`);
  }
  return `[${parts.join(",")}]`;
}

function emitRecord(
  value: object,
  active: WeakSet<object>,
  path: string,
): string {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`canonical value has custom prototype at ${path}`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(descriptors).sort(compareCodeUnits);
  const parts: string[] = [];
  for (const key of keys) {
    const descriptor = descriptors[key]!;
    assertDataDescriptor(descriptor, `${path}.${key}`);
    if (!descriptor.enumerable) {
      throw new TypeError(`canonical value has hidden property at ${path}.${key}`);
    }
    parts.push(
      `${primitiveJson(key)}:${emitCanonical(descriptor.value, active, `${path}.${key}`)}`,
    );
  }
  return `{${parts.join(",")}}`;
}

function emitCanonical(
  value: unknown,
  active: WeakSet<object>,
  path: string,
): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return primitiveJson(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`canonical value has non-finite number at ${path}`);
    }
    return primitiveJson(value);
  }
  if (typeof value !== "object") {
    throw new TypeError(`unsupported canonical value at ${path}`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError(`canonical value has symbol keys at ${path}`);
  }
  if (active.has(value)) {
    throw new TypeError(`canonical value contains a cycle at ${path}`);
  }

  active.add(value);
  try {
    return Array.isArray(value)
      ? emitArray(value, active, path)
      : emitRecord(value, active, path);
  } finally {
    active.delete(value);
  }
}

export function canonicalJsonBytes(value: unknown): Uint8Array {
  return encoder.encode(`${emitCanonical(value, new WeakSet(), "$")}\n`);
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function canonicalSha256(value: unknown): Promise<string> {
  return sha256Hex(canonicalJsonBytes(value));
}

function sortedState(state: CanonicalPublicState): CanonicalPublicState {
  return {
    ...state,
    items: [...state.items].sort((left, right) => left.id - right.id),
    events: [...state.events].sort((left, right) => left.id - right.id),
    sources: [...state.sources].sort((left, right) =>
      compareCodeUnits(left.id, right.id),
    ),
    newsletters: [...state.newsletters].sort(
      (left, right) => left.id - right.id,
    ),
    policies: [...state.policies].sort((left, right) =>
      compareCodeUnits(left.version, right.version),
    ),
  };
}

export function canonicalPublicStateBytes(value: unknown): Uint8Array {
  // Validate raw shape first so Zod cannot hide accessors or array properties.
  emitCanonical(value, new WeakSet(), "$");
  return canonicalJsonBytes(sortedState(canonicalStateSchema.parse(value)));
}

export function canonicalPublicStateSha256(value: unknown): Promise<string> {
  return sha256Hex(canonicalPublicStateBytes(value));
}
