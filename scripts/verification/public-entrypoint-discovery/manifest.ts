import { readFileSync } from "node:fs";
import type { AppPathsManifest } from "./types";

export function readAppPathsManifest(manifestPath: string): AppPathsManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read App Router manifest ${manifestPath}: ${detail}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("App Router manifest must be an object");
  }

  const entries = Object.entries(parsed);
  if (
    entries.some(
      ([appPath, buildModule]) =>
        !appPath.startsWith("/") || typeof buildModule !== "string",
    )
  ) {
    throw new Error(
      "App Router manifest must map absolute app paths to string module paths",
    );
  }

  return Object.freeze(
    Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right))),
  );
}
