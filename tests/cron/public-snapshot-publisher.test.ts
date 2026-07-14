import { afterEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { handlePublishPublicCron } from "@/app/api/cron/publish-public/route";
import { runIncrementalPublicPublisher } from "@/lib/public-content/publisher/runtime";
import { CRON_RUNNERS, resolveCronKind } from "@/scripts/ops/run-cron";
import { runReceipt } from "../public-content/contract-fixtures";

const previousSecret = process.env.CRON_SECRET;

afterEach(() => {
  if (previousSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = previousSecret;
});

describe("public snapshot publisher cron", () => {
  test("requires cron authentication before invoking the publisher", async () => {
    process.env.CRON_SECRET = "cron-test-secret";
    let calls = 0;
    const run = async () => {
      calls += 1;
      return runReceipt();
    };

    const denied = await handlePublishPublicCron(
      new Request("https://example.com/api/cron/publish-public", {
        headers: { authorization: "Bearer wrong" },
      }),
      run,
    );
    expect(denied.status).toBe(401);
    expect(calls).toBe(0);

    const allowed = await handlePublishPublicCron(
      new Request("https://example.com/api/cron/publish-public", {
        headers: { authorization: "Bearer cron-test-secret" },
      }),
      run,
    );
    expect(allowed.status).toBe(200);
    expect(calls).toBe(1);
    expect(await allowed.json()).toMatchObject({
      kind: "publish-public",
      receipt: runReceipt(),
    });
  });

  test("uses the exact four-times-hourly schedule and shared runtime", async () => {
    const vercel = JSON.parse(await readFile("vercel.json", "utf8")) as {
      crons: Array<{ path: string; schedule: string }>;
    };
    expect(
      vercel.crons.filter(({ path }) => path === "/api/cron/publish-public"),
    ).toEqual([
      {
        path: "/api/cron/publish-public",
        schedule: "12,27,42,57 * * * *",
      },
    ]);
    expect(resolveCronKind("publish-public")).toBe("publish-public");
    expect(CRON_RUNNERS["publish-public"]).toBe(
      runIncrementalPublicPublisher,
    );

    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(packageJson.scripts["cron:publish-public"]).toBe(
      "bun scripts/ops/run-cron.ts publish-public",
    );
  });

  test("recurring entrypoints cannot import bootstrap or full materialization", async () => {
    const recurringFiles = [
      "app/api/cron/publish-public/route.ts",
      "lib/public-content/publisher/runtime.ts",
      "scripts/ops/publish-public-snapshot.ts",
      "scripts/ops/run-cron.ts",
    ];
    const source = (
      await Promise.all(recurringFiles.map((path) => readFile(path, "utf8")))
    ).join("\n");
    expect(source).not.toMatch(/publisher\/bootstrap|bootstrapPublicSnapshot/);
    expect(source).not.toMatch(/canonicalStateSchema|full.?material/i);
    expect(source).toContain("runIncrementalPublicPublisher");
  });
});
