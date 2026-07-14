import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import {
  LIVE_PRODUCTION_INTEGRATION_INPUTS,
  PRODUCTION_INTEGRATION_INPUTS,
  assertProductionIntegrationOptIn,
  createHermeticRuntimeOverrides,
  discoverDefaultTestInputs,
  discoverTursoGatedTestInputs,
  selectHermeticTestInputs,
} from "@/scripts/verification/run-hermetic-tests";
import {
  createHermeticVerifyStages,
  prepareHermeticBuildDatabase,
} from "@/scripts/verification/run-hermetic-verify";
import { runCheckedCommand } from "@/scripts/verification/run-checked-command";
import { isPolicyControlledEnvironmentKey } from "@/scripts/verification/environment-policy";
import { createClient } from "@libsql/client";

const root = resolve(import.meta.dir, "../..");

describe("hermetic package entrypoints", () => {
  test("default test and verify never opt into .env.local", async () => {
    const pkg = JSON.parse(
      await Bun.file(resolve(root, "package.json")).text(),
    ) as { scripts: Record<string, string> };

    expect(pkg.scripts.test).toBe(
      "bun scripts/verification/run-hermetic-tests.ts",
    );
    expect(pkg.scripts.verify).toBe(
      "bun scripts/verification/run-hermetic-verify.ts",
    );
    expect(pkg.scripts["test:production"]).toBe(
      "bun scripts/verification/run-hermetic-tests.ts --production",
    );
    expect(pkg.scripts["verify:r2-public"]).toBe(
      "bun scripts/verification/r2-public.ts",
    );

    expect(pkg.scripts.test).not.toContain("env-file");
    expect(pkg.scripts.verify).not.toContain("env-file");
  });

  test("production integration inputs are explicit, guarded, and undiscoverable by default", async () => {
    expect(PRODUCTION_INTEGRATION_INPUTS).toHaveLength(11);
    expect(new Set(PRODUCTION_INTEGRATION_INPUTS).size).toBe(
      PRODUCTION_INTEGRATION_INPUTS.length,
    );

    const defaultInputs = discoverDefaultTestInputs(root);
    for (const input of PRODUCTION_INTEGRATION_INPUTS) {
      expect(input).toEndWith(".integration.ts");
      expect(defaultInputs).not.toContain(input);
      const source = await readFile(resolve(root, input), "utf8");
      expect(source).toContain("assertProductionIntegrationOptIn();");
      expect(source).not.toMatch(/describe\.skip|test\.skip|describeOrSkip/);
      expect(source).not.toMatch(/\breturn\s*;/);
    }

    for (const input of LIVE_PRODUCTION_INTEGRATION_INPUTS) {
      const source = await readFile(resolve(root, input), "utf8");
      expect(source).toContain("assertProductionIntegrationOptIn();");
      expect(source).not.toMatch(/describe\.skip|test\.skip|describeOrSkip/);
      expect(source).not.toMatch(/\breturn\s*;/);
    }

    expect(discoverTursoGatedTestInputs(root)).toEqual([]);
    expect(() =>
      selectHermeticTestInputs(root, [PRODUCTION_INTEGRATION_INPUTS[0]]),
    ).toThrow(/production integration input/i);
  });

  test("focused test selection only accepts regular files from default discovery", () => {
    const focused = "tests/verification/environment-policy.test.ts";
    expect(selectHermeticTestInputs(root, [focused])).toEqual([focused]);

    for (const input of [
      "tests/integration/production",
      "tests/integration/production/api",
      LIVE_PRODUCTION_INTEGRATION_INPUTS[0],
    ]) {
      expect(() => selectHermeticTestInputs(root, [input])).toThrow(
        /production integration input/i,
      );
    }

    for (const input of ["tests", "package.json", "workers/newsletter/select.ts"]) {
      expect(() => selectHermeticTestInputs(root, [input])).toThrow(
        /default discovered test file/i,
      );
    }
  });

  test("production integration requires both the explicit switch and a DB URL", () => {
    expect(() => assertProductionIntegrationOptIn({})).toThrow(
      /RUN_PRODUCTION_INTEGRATION=1/,
    );
    expect(() =>
      assertProductionIntegrationOptIn({ RUN_PRODUCTION_INTEGRATION: "1" }),
    ).toThrow(/TURSO_DATABASE_URL/);
    expect(() =>
      assertProductionIntegrationOptIn({
        RUN_PRODUCTION_INTEGRATION: "1",
        TURSO_DATABASE_URL: "libsql://production-sentinel.invalid",
      }),
    ).not.toThrow();
  });

  test("runtime overrides use only local libSQL and fake R2 values", () => {
    const overrides = createHermeticRuntimeOverrides(
      resolve(tmpdir(), "newsroom-hermetic-test"),
    );

    expect(overrides.TURSO_DATABASE_URL).toStartWith("file:");
    expect(overrides.TURSO_DATABASE_URL).not.toContain("libsql://");
    expect(overrides.TURSO_AUTH_TOKEN).toStartWith("fake-");
    expect(overrides.TURSO_API_TOKEN).toStartWith("fake-");
    expect(overrides.DATABASE_AUTH_TOKEN).toStartWith("fake-");
    expect(overrides.LIBSQL_AUTH_TOKEN).toStartWith("fake-");
    expect(overrides.R2_ENDPOINT).toBe("https://r2.invalid");
    expect(overrides.R2_PUBLIC_BASE_URL).toBe("https://content.invalid");
    for (const key of [
      "R2_ACCESS_KEY_ID",
      "R2_ACCOUNT_ID",
      "R2_BUCKET",
      "R2_SECRET_ACCESS_KEY",
    ]) {
      expect(overrides[key]).toStartWith("fake-");
    }

    expect(
      Object.keys(overrides).filter(isPolicyControlledEnvironmentKey).sort(),
    ).toEqual(
      [
        "AWS_ACCESS_KEY_ID",
        "AWS_DEFAULT_REGION",
        "AWS_ENDPOINT_URL",
        "AWS_REGION",
        "AWS_SECRET_ACCESS_KEY",
        "AWS_SESSION_TOKEN",
        "CF_ACCOUNT_ID",
        "CF_API_KEY",
        "CF_API_TOKEN",
        "CF_ZONE_ID",
        "CLOUDFLARE_ACCOUNT_ID",
        "CLOUDFLARE_API_KEY",
        "CLOUDFLARE_API_TOKEN",
        "CLOUDFLARE_ZONE_ID",
        "DATABASE_AUTH_TOKEN",
        "DATABASE_URL",
        "LIBSQL_AUTH_TOKEN",
        "LIBSQL_URL",
        "R2_ACCESS_KEY_ID",
        "R2_ACCOUNT_ID",
        "R2_BUCKET",
        "R2_ENDPOINT",
        "R2_PUBLIC_BASE_URL",
        "R2_SECRET_ACCESS_KEY",
        "TURSO_API_TOKEN",
        "TURSO_AUTH_TOKEN",
        "TURSO_DATABASE_URL",
        "TURSO_ORG",
      ].sort(),
    );
  });

  test("verify supplies the same explicit poison/local environment to Next build", () => {
    const fixtureRoot = resolve(tmpdir(), "newsroom-hermetic-verify");
    const stages = createHermeticVerifyStages(root, fixtureRoot);
    const build = stages.find((stage) => stage.name === "build");

    expect(build).toBeDefined();
    expect(build?.command).toEqual([
      process.execPath,
      "--no-env-file",
      "run",
      "build",
    ]);
    expect(build?.env.TURSO_DATABASE_URL).toStartWith("file:");
    expect(build?.env.R2_ENDPOINT).toBe("https://r2.invalid");
    expect(build?.env.R2_SECRET_ACCESS_KEY).toStartWith("fake-");
  });

  test("verify prepares only the minimal local build-time source catalog", async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), "newsroom-build-db-"));
    try {
      await prepareHermeticBuildDatabase(fixtureRoot);
      const databaseUrl = createHermeticRuntimeOverrides(fixtureRoot)
        .TURSO_DATABASE_URL;
      const client = createClient({ url: databaseUrl });
      try {
        const result = await client.execute(
          'select id, name_en, name_zh, kind, "group", locale from sources where enabled = 1',
        );
        expect(result.rows).toEqual([]);
      } finally {
        client.close();
      }
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  test("Next's env loader cannot replace explicit local values from .env.local", async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), "newsroom-next-env-"));
    const overrides = createHermeticRuntimeOverrides(fixtureRoot);
    const expectedControlledEnvironment = Object.fromEntries(
      Object.entries(overrides).filter(([key]) =>
        isPolicyControlledEnvironmentKey(key),
      ),
    );
    try {
      await mkdir(fixtureRoot, { recursive: true });
      await writeFile(
        join(fixtureRoot, ".env.local"),
        Object.keys(expectedControlledEnvironment)
          .map((key) => `${key}=dotenv-production-sentinel-${key}`)
          .join("\n"),
      );

      const result = await runCheckedCommand({
        command: [
          process.execPath,
          "--no-env-file",
          resolve(root, "tests/fixtures/verification/next-env-probe.ts"),
          fixtureRoot,
        ],
        cwd: root,
        completionSentinel: "NEXT_ENV_POISON_PROBE_COMPLETE",
        inheritedEnv: {
          ...process.env,
          TURSO_DATABASE_URL: "libsql://inherited-production-sentinel.invalid",
          TURSO_AUTH_TOKEN: "inherited-production-auth-token-sentinel",
          R2_SECRET_ACCESS_KEY: "inherited-production-secret-sentinel",
          AWS_SESSION_TOKEN: "inherited-production-session-token-sentinel",
        },
        env: {
          ...overrides,
          NODE_ENV: "production",
          EXPECTED_CONTROLLED_ENV_JSON: JSON.stringify(
            expectedControlledEnvironment,
          ),
        },
      });

      expect(result.ok).toBe(true);
      expect(result.reason).toBe("success");
      expect(result.stdout).not.toContain("production-sentinel");
      expect(result.stderr).not.toContain("production-sentinel");
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  test("default discovery covers both tests and worker suites without production inputs", () => {
    const inputs = discoverDefaultTestInputs(root);
    const asRelative = inputs.map((input) => relative(root, resolve(root, input)));

    expect(asRelative).toContain("tests/verification/environment-policy.test.ts");
    expect(asRelative).toContain("workers/newsletter/select.test.ts");
    expect(asRelative.some((input) => input.endsWith(".integration.ts"))).toBe(
      false,
    );
  });
});
