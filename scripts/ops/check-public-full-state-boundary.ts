import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  PUBLIC_SERVING_ENTRYPOINTS,
  SNAPSHOT_ONLY_ENTRYPOINTS,
} from "@/lib/public-content/entrypoints";

const FORBIDDEN_ENTRYPOINT_TOKENS = [
  "readCanonicalState(",
  "readPublicPageSnapshot(",
  "readPublicSnapshot(",
] as const;

const DIRECT_RUNTIME_FILES = [
  "lib/public-content/direct-route-read.ts",
  "lib/public-content/home-page-model.ts",
  "lib/public-content/page-models.ts",
  "lib/public-content/rss-http.ts",
  "lib/shell/chrome-data.ts",
] as const;

export type PublicFullStateBoundaryReport = {
  ok: boolean;
  violations: string[];
};

export function checkPublicFullStateBoundary(
  rootDir: string,
): PublicFullStateBoundaryReport {
  const violations: string[] = [];
  for (const entrypoint of SNAPSHOT_ONLY_ENTRYPOINTS) {
    if (!entrypoint.sourcePath) continue;
    const source = read(rootDir, entrypoint.sourcePath);
    for (const token of FORBIDDEN_ENTRYPOINT_TOKENS) {
      if (source.includes(token)) {
        violations.push(`${entrypoint.sourcePath}: forbidden ${token}`);
      }
    }
  }

  for (const file of DIRECT_RUNTIME_FILES) {
    const source = read(rootDir, file);
    if (source.includes("publicSnapshotReader().readCanonicalState(")) {
      violations.push(`${file}: canonical read is not release-scoped`);
    }
    if (source.includes("readPublicPageSnapshot")) {
      violations.push(`${file}: imports the aggregate page snapshot helper`);
    }
  }

  for (const entrypoint of PUBLIC_SERVING_ENTRYPOINTS) {
    if (
      entrypoint.kind !== "page" ||
      !entrypoint.pathname.includes("/admin/") ||
      !entrypoint.sourcePath
    ) continue;
    const source = read(rootDir, entrypoint.sourcePath);
    if (source.includes("@/lib/shell/chrome-data")) {
      violations.push(`${entrypoint.sourcePath}: admin chrome depends on public R2`);
    }
    if (!source.includes("@/lib/shell/admin-chrome-data")) {
      violations.push(`${entrypoint.sourcePath}: admin chrome is not Turso-backed`);
    }
  }

  const direct = read(rootDir, "lib/public-content/direct-route-read.ts");
  if (direct.includes("readCanonicalState(")) {
    violations.push("lib/public-content/direct-route-read.ts: direct reader aggregates canonical state");
  }

  return { ok: violations.length === 0, violations };
}

function read(rootDir: string, file: string): string {
  return readFileSync(resolve(rootDir, file), "utf8");
}

if (import.meta.main) {
  const report = checkPublicFullStateBoundary(process.cwd());
  if (!report.ok) {
    for (const violation of report.violations) console.error(violation);
    process.exitCode = 1;
  } else {
    console.log("public full-state boundary: ok");
  }
}
