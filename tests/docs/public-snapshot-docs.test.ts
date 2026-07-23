import { existsSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import {
  ANONYMOUS_SERVING_ENTRYPOINTS,
  SNAPSHOT_ONLY_ENTRYPOINTS,
} from "@/lib/public-content/entrypoints";
import { readSource, sourcePath } from "@/tests/helpers/source";

const docsIndex = readSource("docs/README.md");
const overview = readSource("docs/architecture/overview.md");
const ingestion = readSource("docs/architecture/ingestion.md");
const agentAccess = readSource("docs/agent-access/README.md");
const testing = readSource("docs/testing/strategy.md");
const handoff = readSource("docs/HANDOFF.md");
const operations = readSource("docs/operations/public-snapshots.md");
const envExample = readSource(".env.example");
const packageJson = JSON.parse(readSource("package.json")) as {
  scripts: Record<string, string>;
};
const vercel = JSON.parse(readSource("vercel.json")) as {
  crons: Array<{ path: string; schedule: string }>;
};

describe("public snapshot documentation contracts", () => {
  test("routes readers to one current operator runbook and states the external gate", () => {
    expect(docsIndex).toContain(
      "[`operations/public-snapshots.md`](./operations/public-snapshots.md)",
    );
    expect(existsSync(sourcePath("docs/operations/public-snapshots.md"))).toBeTrue();
    expect(handoff).toContain("R2 public-read decoupling implemented locally");
    expect(handoff).toContain("No production migration, R2 release, deploy");
    expect(operations).toContain("require explicit AX authorization");
    expect(operations).toContain(
      "recovery still require explicit authorization",
    );
    expect(operations).toContain("production serves anonymous public reads from R2");
  });

  test("documents the exhaustive anonymous boundary and no DB fallback", () => {
    expect(ANONYMOUS_SERVING_ENTRYPOINTS.length).toBeGreaterThan(0);
    expect(SNAPSHOT_ONLY_ENTRYPOINTS.length).toBeGreaterThan(0);
    expect(
      SNAPSHOT_ONLY_ENTRYPOINTS.every(
        ({ access, surfaces }) =>
          access === "snapshot-only" &&
          surfaces.includes("GET") &&
          surfaces.includes("HEAD"),
      ),
    ).toBeTrue();
    for (const text of [overview, ingestion, agentAccess, operations]) {
      expect(text).toContain("R2_PUBLIC_BASE_URL");
      expect(text.toLowerCase()).toContain("no db fallback");
    }
    expect(overview).toContain("Anonymous HTML, RSC, JSON, event, source, daily, and RSS");
    expect(ingestion).toContain("anonymous HTML/RSC/JSON/RSS readers");
    expect(agentAccess).toContain("returns controlled 503 without a DB fallback");
  });

  test("keeps publisher cadence and environment names aligned with runtime", () => {
    const publisherCron = vercel.crons.find(
      ({ path }) => path === "/api/cron/publish-public",
    );
    expect(publisherCron?.schedule).toBe("12,27,42,57 * * * *");
    expect(ingestion).toContain("`12,27,42,57 * * * *`");
    expect(operations).toContain("`12,27,42,57 * * * *`");

    for (const name of [
      "R2_PUBLIC_BASE_URL",
      "R2_BUCKET",
      "R2_ACCOUNT_ID",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
    ]) {
      expect(envExample).toMatch(new RegExp(`^${name}=`, "m"));
      expect(operations).toContain(name);
    }
    expect(envExample).not.toContain("NEXT_PUBLIC_R2");
  });

  test("documents search behavior, rollback, retention and credential cleanup", () => {
    expect(agentAccess).toContain(
      "HTTP 422 `semantic_search_not_supported`",
    );
    expect(operations).toContain("at least seven releases and 30 days");
    expect(operations).toContain("conditionally replace `current.json`");
    expect(operations).toContain("Do not enable a DB fallback");
    expect(operations).toContain("revoke them and remove plaintext download files");
    expect(operations).toContain("<136,986 rows/hour");
    expect(operations).toContain("<13,699 rows/hour");
  });

  test("documents the split item-body artifact layout and compatibility path", () => {
    expect(operations).toContain("`state/items/<00-7f>`");
    expect(operations).toContain("`bodies/items/<00-7f>`");
    expect(operations).toContain("`bodyMd: null`");
    expect(operations).toContain("release-pinned");
    expect(operations).toContain("all 128 body shards");
    expect(operations).toContain("`state/sources`");
  });

  test("uses hermetic focused tests and receipt-backed production criteria", () => {
    expect(agentAccess).not.toContain("bun test --env-file=.env.local");
    expect(testing).toContain("smallest focused hermetic test");
    expect(testing).toContain("Do not pay a full build/Knip/test pass after every small edit");
    expect(testing).toContain("R2_PUBLIC_EVIDENCE_MANIFEST");
    expect(operations).toContain("10,000");
    expect(operations).toContain("1 GiB");
    expect(operations).toContain("named exact window");
    expect(operations).toContain("stabilityReceipt");
    expect(operations).toContain("rollbackReceipt");
    for (const script of [
      "evidence:load-public",
      "evidence:r2-cache",
      "evidence:turso-window",
      "evidence:public-cutover",
    ]) {
      expect(packageJson.scripts[script]).toBeDefined();
      expect(testing).toContain(script);
    }
  });
});
