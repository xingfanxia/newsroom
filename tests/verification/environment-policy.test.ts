import { describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EnvironmentPolicyError,
  createHermeticEnvironment,
  redactSecretValues,
} from "@/scripts/verification/environment-policy";

describe("hermetic environment policy", () => {
  test("disables Bun's implicit dotenv loading at the repository root", () => {
    const bunfig = readFileSync(join(process.cwd(), "bunfig.toml"), "utf8");
    expect(bunfig).toMatch(/^env\s*=\s*false\s*$/m);
  });

  test("the checked-in Bun config actually suppresses dotenv discovery", async () => {
    const directory = mkdtempSync(join(tmpdir(), "newsroom-bunfig-"));
    const sentinel = "fake-dotenv-value-that-must-not-load";

    try {
      writeFileSync(
        join(directory, "bunfig.toml"),
        readFileSync(join(process.cwd(), "bunfig.toml"), "utf8"),
      );
      writeFileSync(
        join(directory, ".env.local"),
        `HERMETIC_DOTENV_SENTINEL=${sentinel}\n`,
      );

      const child = Bun.spawn(
        [
          process.execPath,
          "-e",
          'process.stdout.write(process.env.HERMETIC_DOTENV_SENTINEL ?? "absent")',
        ],
        {
          cwd: directory,
          env: createHermeticEnvironment({ inherited: process.env }),
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [exitCode, stdout] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
      ]);

      expect(exitCode).toBe(0);
      expect(stdout).toBe("absent");
      expect(stdout).not.toContain(sentinel);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("drops inherited production credentials while preserving ordinary process state", () => {
    const environment = createHermeticEnvironment({
      inherited: {
        PATH: "/usr/bin:/bin",
        HOME: "/tmp/hermetic-home",
        TURSO_DATABASE_URL: "libsql://production-db.turso.io",
        TURSO_AUTH_TOKEN: "prod-turso-token",
        R2_ENDPOINT: "https://account.r2.cloudflarestorage.com",
        R2_SECRET_ACCESS_KEY: "prod-r2-secret",
        CLOUDFLARE_API_TOKEN: "prod-cloudflare-token",
        CF_API_TOKEN: "prod-cf-token",
        AWS_ACCESS_KEY_ID: "prod-aws-access-key",
        AWS_SECRET_ACCESS_KEY: "prod-aws-secret",
      },
    });

    expect(environment.PATH).toBe("/usr/bin:/bin");
    expect(environment.HOME).toBe("/tmp/hermetic-home");
    expect(environment.TURSO_DATABASE_URL).toBeUndefined();
    expect(environment.TURSO_AUTH_TOKEN).toBeUndefined();
    expect(environment.R2_ENDPOINT).toBeUndefined();
    expect(environment.R2_SECRET_ACCESS_KEY).toBeUndefined();
    expect(environment.CLOUDFLARE_API_TOKEN).toBeUndefined();
    expect(environment.CF_API_TOKEN).toBeUndefined();
    expect(environment.AWS_ACCESS_KEY_ID).toBeUndefined();
    expect(environment.AWS_SECRET_ACCESS_KEY).toBeUndefined();
  });

  test("permits explicit local libSQL and fake object-store overrides", () => {
    const environment = createHermeticEnvironment({
      inherited: { PATH: process.env.PATH },
      overrides: {
        TURSO_DATABASE_URL: "file:./tmp/hermetic.sqlite",
        TURSO_AUTH_TOKEN: "test-turso-auth-token",
        TURSO_API_TOKEN: "test-turso-api-token",
        TURSO_ORG: "test-turso-org",
        DATABASE_URL: "file:///tmp/hermetic.sqlite",
        DATABASE_AUTH_TOKEN: "test-database-auth-token",
        LIBSQL_URL: "file:///tmp/hermetic.sqlite",
        LIBSQL_AUTH_TOKEN: "test-libsql-auth-token",
        R2_ACCOUNT_ID: "test-account",
        R2_BUCKET: "test-newsroom-public",
        R2_ENDPOINT: "http://127.0.0.1:9000",
        R2_PUBLIC_BASE_URL: "https://newsroom-snapshots.invalid",
        R2_ACCESS_KEY_ID: "test-access-key",
        R2_SECRET_ACCESS_KEY: "test-secret-key",
        AWS_ACCESS_KEY_ID: "test-access-key",
        AWS_SECRET_ACCESS_KEY: "test-secret-key",
        AWS_SESSION_TOKEN: "test-session-token",
        AWS_ENDPOINT_URL: "http://[::1]:9000",
        AWS_REGION: "auto",
        CLOUDFLARE_API_TOKEN: "test-cloudflare-api-token",
        CF_API_TOKEN: "test-cf-api-token",
      },
    });

    expect(environment.TURSO_DATABASE_URL).toBe(
      "file:./tmp/hermetic.sqlite",
    );
    expect(environment.DATABASE_URL).toBe("file:///tmp/hermetic.sqlite");
    expect(environment.TURSO_AUTH_TOKEN).toBe("test-turso-auth-token");
    expect(environment.TURSO_API_TOKEN).toBe("test-turso-api-token");
    expect(environment.LIBSQL_AUTH_TOKEN).toBe("test-libsql-auth-token");
    expect(environment.R2_ENDPOINT).toBe("http://127.0.0.1:9000");
    expect(environment.R2_PUBLIC_BASE_URL).toBe(
      "https://newsroom-snapshots.invalid",
    );
    expect(environment.AWS_ENDPOINT_URL).toBe("http://[::1]:9000");
    expect(environment.R2_SECRET_ACCESS_KEY).toBe("test-secret-key");
    expect(environment.AWS_SESSION_TOKEN).toBe("test-session-token");
    expect(environment.CLOUDFLARE_API_TOKEN).toBe(
      "test-cloudflare-api-token",
    );
    expect(environment.AWS_REGION).toBe("auto");

    const poison = createHermeticEnvironment({
      inherited: {},
      overrides: {
        TURSO_DATABASE_URL: "http://127.0.0.1:43123",
      },
    });
    expect(poison.TURSO_DATABASE_URL).toBe("http://127.0.0.1:43123");
  });

  test("rejects unsafe explicit overrides without rendering their values", () => {
    const databaseUrl = "libsql://private-production-db.turso.io";
    const remoteFileUrl = "file://remote-host/shared.sqlite";
    const objectSecret = "production-object-store-secret";
    let error: unknown;

    try {
      createHermeticEnvironment({
        inherited: {},
        overrides: {
          TURSO_DATABASE_URL: databaseUrl,
          LIBSQL_URL: remoteFileUrl,
          R2_SECRET_ACCESS_KEY: objectSecret,
        },
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(EnvironmentPolicyError);
    const diagnostic = String(error);
    expect(diagnostic).toContain("TURSO_DATABASE_URL");
    expect(diagnostic).toContain("LIBSQL_URL");
    expect(diagnostic).toContain("R2_SECRET_ACCESS_KEY");
    expect(diagnostic).not.toContain(databaseUrl);
    expect(diagnostic).not.toContain(remoteFileUrl);
    expect(diagnostic).not.toContain(objectSecret);
  });

  test("redacts known secret values from captured diagnostics", () => {
    const tursoSecret = "known-turso-secret-value";
    const r2Secret = "known-r2-secret-value";
    const awsAccessKey = "known-aws-access-key";
    const cloudflareApiKey = "known-cloudflare-api-key";
    const cfApiKey = "known-cf-api-key";
    const cfPrivateKey = "known-cf-private-key";
    const diagnostic = redactSecretValues(
      [
        `turso=${tursoSecret}`,
        `r2=${r2Secret}`,
        `aws=${awsAccessKey}`,
        `cloudflare=${cloudflareApiKey}`,
        `cf=${cfApiKey}`,
        `private=${cfPrivateKey}`,
        "harmless=visible",
      ].join(" "),
      {
        TURSO_AUTH_TOKEN: tursoSecret,
        R2_SECRET_ACCESS_KEY: r2Secret,
        AWS_ACCESS_KEY_ID: awsAccessKey,
        CLOUDFLARE_API_KEY: cloudflareApiKey,
        CF_API_KEY: cfApiKey,
        CF_PRIVATE_KEY: cfPrivateKey,
        HARMLESS: "visible",
      },
    );

    expect(diagnostic).not.toContain(tursoSecret);
    expect(diagnostic).not.toContain(r2Secret);
    expect(diagnostic).not.toContain(awsAccessKey);
    expect(diagnostic).not.toContain(cloudflareApiKey);
    expect(diagnostic).not.toContain(cfApiKey);
    expect(diagnostic).not.toContain(cfPrivateKey);
    expect(diagnostic).toContain("harmless=visible");
    expect(diagnostic).toContain("[REDACTED]");
  });
});
