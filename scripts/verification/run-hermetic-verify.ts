import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createClient } from "@libsql/client";
import type { EnvironmentInput } from "./environment-policy";
import { runCheckedCommand } from "./run-checked-command";
import { createHermeticRuntimeOverrides } from "./run-hermetic-tests";

export interface HermeticVerifyStage {
  name:
    | "typecheck"
    | "lint"
    | "build"
    | "dead-files"
    | "dead-exports"
    | "dead-types"
    | "test";
  command: [string, ...string[]];
  env: Record<string, string>;
  deadlineMs: number;
}

export function createHermeticVerifyStages(
  root: string,
  fixtureRoot: string,
): HermeticVerifyStage[] {
  const testEnvironment = createHermeticRuntimeOverrides(fixtureRoot);
  const productionBuildEnvironment = {
    ...testEnvironment,
    NODE_ENV: "production",
  };
  const bunRun = (script: string): [string, ...string[]] => [
    process.execPath,
    "--no-env-file",
    "run",
    script,
  ];

  return [
    {
      name: "typecheck",
      command: bunRun("typecheck"),
      env: testEnvironment,
      deadlineMs: 180_000,
    },
    {
      name: "lint",
      command: bunRun("lint"),
      env: testEnvironment,
      deadlineMs: 180_000,
    },
    {
      name: "build",
      command: bunRun("build"),
      env: productionBuildEnvironment,
      deadlineMs: 600_000,
    },
    {
      name: "dead-files",
      command: bunRun("code:dead"),
      env: testEnvironment,
      deadlineMs: 300_000,
    },
    {
      name: "dead-exports",
      command: bunRun("code:dead:exports"),
      env: testEnvironment,
      deadlineMs: 300_000,
    },
    {
      name: "dead-types",
      command: bunRun("code:dead:types"),
      env: testEnvironment,
      deadlineMs: 300_000,
    },
    {
      name: "test",
      command: [
        process.execPath,
        "--no-env-file",
        resolve(root, "scripts/verification/run-hermetic-tests.ts"),
      ],
      env: testEnvironment,
      deadlineMs: 600_000,
    },
  ];
}

export async function prepareHermeticBuildDatabase(
  fixtureRoot: string,
): Promise<void> {
  const databaseUrl = createHermeticRuntimeOverrides(fixtureRoot)
    .TURSO_DATABASE_URL;
  const client = createClient({ url: databaseUrl });
  try {
    await client.execute(`
      create table if not exists sources (
        id text primary key,
        name_en text not null,
        name_zh text,
        kind text not null,
        "group" text not null,
        locale text,
        enabled integer not null default 1
      )
    `);
  } finally {
    client.close();
  }
}

function checkedStageCommand(
  root: string,
  sentinel: string,
  command: readonly [string, ...string[]],
): [string, ...string[]] {
  return [
    process.execPath,
    "--no-env-file",
    resolve(root, "scripts/verification/checked-stage.ts"),
    "--sentinel",
    sentinel,
    "--",
    ...command,
  ];
}

export interface HermeticVerifyOptions {
  root?: string;
  inheritedEnv?: EnvironmentInput;
}

export async function runHermeticVerify(
  options: HermeticVerifyOptions = {},
): Promise<number> {
  const root = resolve(options.root ?? join(import.meta.dir, "../.."));
  const fixtureRoot = mkdtempSync(join(tmpdir(), "newsroom-hermetic-verify-"));

  try {
    await prepareHermeticBuildDatabase(fixtureRoot);
    for (const stage of createHermeticVerifyStages(root, fixtureRoot)) {
      const sentinel = `HERMETIC_VERIFY_${stage.name.toUpperCase()}_${randomUUID()}`;
      process.stdout.write(`[hermetic-verify] ${stage.name}\n`);
      const result = await runCheckedCommand({
        command: checkedStageCommand(root, sentinel, stage.command),
        cwd: root,
        completionSentinel: sentinel,
        deadlineMs: stage.deadlineMs,
        inheritedEnv: options.inheritedEnv,
        env: stage.env,
      });
      if (result.stdout.length > 0) process.stdout.write(result.stdout);
      if (result.stderr.length > 0) process.stderr.write(result.stderr);
      if (!result.ok) {
        process.stderr.write(
          `[hermetic-verify] ${stage.name}: ${result.reason}\n`,
        );
        return result.exitCode;
      }
    }

    process.stdout.write("HERMETIC_VERIFY_COMPLETE\n");
    return 0;
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  try {
    if (Bun.argv.length !== 2) {
      throw new Error("hermetic verify does not accept arguments");
    }
    process.exitCode = await runHermeticVerify();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Verify failed";
    process.stderr.write(`[hermetic-verify] ${message}\n`);
    process.exitCode = 2;
  }
}
