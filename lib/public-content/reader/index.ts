import { PublicSnapshotReader } from "./read-release";

let cachedReader: PublicSnapshotReader | null = null;
let cachedBaseUrl: string | null = null;

export function publicSnapshotReader(): PublicSnapshotReader {
  const baseUrl = process.env.R2_PUBLIC_BASE_URL?.trim();
  if (!baseUrl) {
    throw new Error("R2_PUBLIC_BASE_URL is required for public snapshot reads");
  }
  if (!cachedReader || cachedBaseUrl !== baseUrl) {
    cachedReader = new PublicSnapshotReader({ baseUrl });
    cachedBaseUrl = baseUrl;
  }
  return cachedReader;
}

export { PublicSnapshotReader } from "./read-release";
export { PublicSnapshotUnavailableError } from "./types";
