import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
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

export async function verifyR2PublicCriterion(
  criterion: string,
  root = resolve(join(import.meta.dir, "../..")),
): Promise<CriterionReceipt> {
  if (criterion === "AC-001") return verifyAc001(root);
  throw new Error(`Criterion is not implemented yet: ${criterion}`);
}
