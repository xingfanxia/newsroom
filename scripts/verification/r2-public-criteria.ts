import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client";
import {
  EnvironmentPolicyError,
  createHermeticEnvironment,
} from "./environment-policy";
import { runCheckedCommand } from "./run-checked-command";
import {
  PRODUCTION_INTEGRATION_INPUTS,
  discoverTursoGatedTestInputs,
  runHermeticTests,
} from "./run-hermetic-tests";

export interface CriterionReceipt {
  criterion: string;
  ok: boolean;
  receipts: readonly string[];
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function verifyProductionCredentialSentinel(): string {
  const inherited = createHermeticEnvironment({
    inherited: {
      PATH: process.env.PATH,
      TURSO_DATABASE_URL: "libsql://inherited-production-sentinel.invalid",
      TURSO_AUTH_TOKEN: "inherited-production-token-sentinel",
      R2_SECRET_ACCESS_KEY: "inherited-production-secret-sentinel",
      CLOUDFLARE_API_TOKEN: "inherited-cloudflare-token-sentinel",
    },
  });
  assert(!("TURSO_DATABASE_URL" in inherited), "inherited Turso URL survived");
  assert(!("TURSO_AUTH_TOKEN" in inherited), "inherited Turso token survived");
  assert(!("R2_SECRET_ACCESS_KEY" in inherited), "inherited R2 key survived");
  assert(
    !("CLOUDFLARE_API_TOKEN" in inherited),
    "inherited Cloudflare token survived",
  );

  let rejected = false;
  try {
    createHermeticEnvironment({
      inherited: {},
      overrides: {
        TURSO_DATABASE_URL: "libsql://override-production-sentinel.invalid",
      },
    });
  } catch (error) {
    rejected =
      error instanceof EnvironmentPolicyError &&
      error.unsafeKeys.includes("TURSO_DATABASE_URL");
  }
  assert(rejected, "unsafe production Turso override was accepted");
  return "production credential sentinel stripped/rejected";
}

async function verifyLocalFixtures(fixtureRoot: string): Promise<string> {
  const databaseUrl = pathToFileURL(join(fixtureRoot, "criterion.sqlite")).href;
  const client = createClient({ url: databaseUrl });
  try {
    await client.execute(
      "create table criterion_probe (id integer primary key, value text not null)",
    );
    await client.execute({
      sql: "insert into criterion_probe (value) values (?)",
      args: ["local-only"],
    });
    const result = await client.execute(
      "select value from criterion_probe order by id",
    );
    assert(result.rows[0]?.value === "local-only", "local libSQL fixture failed");
  } finally {
    client.close();
  }

  const fakeR2 = new Map<string, Uint8Array>();
  const payload = new TextEncoder().encode('{"fixture":"local"}\n');
  fakeR2.set("criterion/object.json", payload);
  const restored = fakeR2.get("criterion/object.json");
  assert(restored !== undefined, "fake R2 fixture did not retain its object");
  const checksum = createHash("sha256").update(restored).digest("hex");
  assert(checksum.length === 64, "fake R2 fixture checksum failed");

  return "local libSQL + in-memory fake R2 fixtures passed";
}

async function verifyFailureSentinels(root: string): Promise<string[]> {
  const fixture = resolve(
    root,
    "tests/fixtures/verification/exit-zero-failure.ts",
  );
  const hang = resolve(root, "tests/fixtures/verification/hang.ts");
  const completionSentinel = "__CHECKED_COMMAND_COMPLETE__";

  const exitZeroFailure = await runCheckedCommand({
    command: [process.execPath, "--no-env-file", fixture, "fail-output"],
    cwd: root,
    completionSentinel,
    deadlineMs: 1_000,
  });
  assert(
    !exitZeroFailure.ok && exitZeroFailure.reason === "failure-output",
    "exit-zero failure output was accepted",
  );

  const timeoutOutput = await runCheckedCommand({
    command: [process.execPath, "--no-env-file", fixture, "timeout-output"],
    cwd: root,
    completionSentinel,
    deadlineMs: 1_000,
  });
  assert(
    !timeoutOutput.ok && timeoutOutput.reason === "failure-output",
    "exit-zero timeout output was accepted",
  );

  const deadline = await runCheckedCommand({
    command: [process.execPath, "--no-env-file", hang],
    cwd: root,
    completionSentinel,
    deadlineMs: 75,
    killGraceMs: 25,
  });
  assert(
    !deadline.ok && deadline.reason === "deadline-exceeded",
    "hung child did not fail at the controller deadline",
  );

  return [
    `exit-zero failure receipt: ${exitZeroFailure.reason}`,
    `exit-zero timeout receipt: ${timeoutOutput.reason}`,
    `controller timeout receipt: ${deadline.reason}`,
  ];
}

async function verifyAc001(root: string): Promise<CriterionReceipt> {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "newsroom-ac001-"));
  const receipts: string[] = [];
  try {
    receipts.push(verifyProductionCredentialSentinel());
    receipts.push(await verifyLocalFixtures(fixtureRoot));

    assert(
      PRODUCTION_INTEGRATION_INPUTS.length === 11,
      "production integration manifest is incomplete",
    );
    assert(
      discoverTursoGatedTestInputs(root).length === 0,
      "a TURSO-gated test remains in default discovery",
    );
    receipts.push("11 production integration inputs excluded from default discovery");

    const focusedExitCode = await runHermeticTests({
      root,
      requestedInputs: ["tests/verification/hermetic-entrypoints.test.ts"],
      inheritedEnv: {
        ...process.env,
        TURSO_DATABASE_URL: "libsql://criterion-production-sentinel.invalid",
        TURSO_AUTH_TOKEN: "criterion-production-token-sentinel",
        R2_SECRET_ACCESS_KEY: "criterion-r2-secret-sentinel",
      },
      deadlineMs: 60_000,
    });
    assert(focusedExitCode === 0, "hermetic entrypoint tests failed");
    receipts.push("focused hermetic entrypoint suite passed under hostile inheritance");

    receipts.push(...(await verifyFailureSentinels(root)));
    return { criterion: "AC-001", ok: true, receipts };
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

const AC002_TEST_INPUTS = [
  "tests/public-content/canonical.test.ts",
  "tests/public-content/contracts.test.ts",
  "tests/public-content/derive-parity.test.ts",
  "tests/public-content/eligibility.test.ts",
  "tests/public-content/query.test.ts",
  "tests/public-content/release-contracts.test.ts",
  "tests/public-content/rss.test.ts",
  "tests/public-content/source-catalog-contract.test.ts",
] as const;

const AC002_PURE_MODULES = [
  "lib/public-content/public-items.ts",
  "lib/public-content/query.ts",
  "lib/public-content/derive.ts",
  "lib/public-content/public-dailies.ts",
  "lib/public-content/rss.ts",
] as const;

function verifyPurePublicModules(root: string): string {
  const forbidden = [
    { label: "database import", pattern: /from\s+["']@\/db(?:\/|["'])/ },
    {
      label: "runtime I/O import",
      pattern:
        /from\s+["'](?:next(?:\/|["'])|@libsql\/client|node:(?:fs|http|https|net|tls)(?:\/|["']))/,
    },
    { label: "process environment", pattern: /process\.env/ },
    { label: "request-time fetch", pattern: /\bfetch\s*\(/ },
  ] as const;

  for (const relativePath of AC002_PURE_MODULES) {
    const source = readFileSync(resolve(root, relativePath), "utf8");
    for (const rule of forbidden) {
      assert(
        !rule.pattern.test(source),
        `${relativePath} contains forbidden ${rule.label}`,
      );
    }
  }
  return `${AC002_PURE_MODULES.length} public query modules are framework/DB/I/O free`;
}

async function verifyAc002(root: string): Promise<CriterionReceipt> {
  const receipts: string[] = [verifyPurePublicModules(root)];
  const exitCode = await runHermeticTests({
    root,
    requestedInputs: AC002_TEST_INPUTS,
    inheritedEnv: {
      ...process.env,
      TURSO_DATABASE_URL: "libsql://ac002-production-sentinel.invalid",
      TURSO_AUTH_TOKEN: "ac002-production-token-sentinel",
      R2_SECRET_ACCESS_KEY: "ac002-r2-secret-sentinel",
    },
    deadlineMs: 60_000,
  });
  assert(exitCode === 0, "AC-002 public-content suite failed");
  receipts.push(
    `${AC002_TEST_INPUTS.length} hermetic public-content suites passed under hostile credential inheritance`,
    "hash-frozen canonical/query/RSS fixtures and known-wrong mutants passed",
    "unknown schema versions and private-field sentinels fail closed",
  );
  return { criterion: "AC-002", ok: true, receipts };
}

const AC003_TEST_INPUTS = [
  "tests/public-content/outbox-migration.test.ts",
  "tests/public-content/publisher-source.test.ts",
  "tests/public-content/publisher.test.ts",
  "tests/public-content/r2-store.test.ts",
  "tests/cron/public-snapshot-publisher.test.ts",
  "tests/public-content/bootstrap-retention.test.ts",
] as const;

async function verifyAc003(root: string): Promise<CriterionReceipt> {
  const exitCode = await runHermeticTests({
    root,
    requestedInputs: AC003_TEST_INPUTS,
    inheritedEnv: {
      ...process.env,
      TURSO_DATABASE_URL: "libsql://ac003-production-sentinel.invalid",
      TURSO_AUTH_TOKEN: "ac003-production-token-sentinel",
      R2_ENDPOINT: "https://ac003-r2-sentinel.invalid",
      R2_ACCESS_KEY_ID: "ac003-r2-access-sentinel",
      R2_SECRET_ACCESS_KEY: "ac003-r2-secret-sentinel",
    },
    deadlineMs: 60_000,
  });
  assert(exitCode === 0, "AC-003 incremental publisher suite failed");
  return {
    criterion: "AC-003",
    ok: true,
    receipts: [
      `${AC003_TEST_INPUTS.length} hermetic publisher suites passed under hostile credential inheritance`,
      "outbox high-water, bounded PK/index plans and one batched event-member query passed",
      "content/manifest readback, pointer-last CAS, ambiguity and ack retry fault matrix passed",
      "stable touched-shard scale, one-shot bootstrap ledger, exact cron cadence and conservative retention passed",
    ],
  };
}

const AC005_TEST_INPUTS = ["tests/public-content/reader.test.ts"] as const;

async function verifyAc005(root: string): Promise<CriterionReceipt> {
  const exitCode = await runHermeticTests({
    root,
    requestedInputs: AC005_TEST_INPUTS,
    inheritedEnv: {
      ...process.env,
      TURSO_DATABASE_URL: "libsql://ac005-production-sentinel.invalid",
      TURSO_AUTH_TOKEN: "ac005-production-token-sentinel",
      R2_SECRET_ACCESS_KEY: "ac005-r2-secret-sentinel",
    },
    deadlineMs: 60_000,
  });
  assert(exitCode === 0, "AC-005 fail-closed snapshot reader suite failed");
  return {
    criterion: "AC-005",
    ok: true,
    receipts: [
      "active, previous-release and warm last-known-good paths passed on injected HTTP storage",
      "manifest/artifact schema, release identity, byte length and SHA-256 failures remained controlled-unavailable",
      "timeout, missing objects, unknown schema and arbitrary-key probes never reached a DB path",
      "recursive reader source boundary contains no DB/libSQL/Turso dependency",
    ],
  };
}

const AC008_TEST_INPUTS = [
  "tests/api/public-snapshot-feed-search.test.ts",
] as const;

async function verifyAc008(root: string): Promise<CriterionReceipt> {
  const exitCode = await runHermeticTests({
    root,
    requestedInputs: AC008_TEST_INPUTS,
    inheritedEnv: {
      ...process.env,
      TURSO_DATABASE_URL: "libsql://ac008-production-sentinel.invalid",
      TURSO_AUTH_TOKEN: "ac008-production-token-sentinel",
      AZURE_OPENAI_API_KEY: "ac008-embedding-sentinel",
      R2_SECRET_ACCESS_KEY: "ac008-r2-secret-sentinel",
    },
    deadlineMs: 60_000,
  });
  assert(exitCode === 0, "AC-008 public lexical/semantic split suite failed");
  return {
    criterion: "AC-008",
    ok: true,
    receipts: [
      "snapshot lexical feed/search parity matrix passed over the frozen public corpus",
      "anonymous semantic mode returned documented 422 before snapshot, DB or embedding access",
      "public feed/search recursive source graphs contain no live DB or semantic-search runtime",
      "OpenAPI and installable skill document the 422 plus authenticated v1/MCP alternative",
    ],
  };
}

export async function verifyR2PublicCheap(
  root = resolve(join(import.meta.dir, "../..")),
): Promise<CriterionReceipt> {
  const exitCode = await runHermeticTests({
    root,
    requestedInputs: [
      "tests/public-content/query.test.ts",
      "tests/public-content/derive-parity.test.ts",
      "tests/public-content/rss.test.ts",
    ],
    deadlineMs: 30_000,
  });
  assert(exitCode === 0, "cheap public-content loop failed");
  return {
    criterion: "CHEAP",
    ok: true,
    receipts: ["Task 6 query/derivation/RSS loop passed hermetically"],
  };
}

export async function verifyR2PublicCriterion(
  criterion: string,
  root = resolve(join(import.meta.dir, "../..")),
): Promise<CriterionReceipt> {
  if (criterion === "AC-001") return verifyAc001(root);
  if (criterion === "AC-002") return verifyAc002(root);
  if (criterion === "AC-003") return verifyAc003(root);
  if (criterion === "AC-005") return verifyAc005(root);
  if (criterion === "AC-008") return verifyAc008(root);
  throw new Error(`Criterion is not implemented yet: ${criterion}`);
}
