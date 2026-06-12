import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const source = readFileSync(resolve(root, "lib/shell/system-stats.ts"), "utf8");

describe("admin system stats source wiring", () => {
  it("derives cron schedules from vercel.json", () => {
    expect(source).toContain('import vercelConfig from "@/vercel.json"');
    expect(source).toContain("vercelConfig as { crons?: VercelCronConfig[] }");
    expect(source).toContain("cadenceMinutesFromCron(c.schedule)");
    expect(source).not.toContain("CRON_CADENCE_MINUTES_BY_PATH");
    expect(source).not.toContain('{ name: "newsletter-daily", schedule: "11 9 * * *"');
  });

  it("keeps item commentary queue aligned with the singleton-only worker", () => {
    expect(source).toContain("itemCommentaryPending");
    expect(source).toContain("${items.clusterId} is null");
    expect(source).toContain("coalesce(${clusters.memberCount}, 1) < 2");
    expect(source).toContain('name: "event-commentary"');
    expect(source).toContain("eventCommentaryPending");
  });
});
