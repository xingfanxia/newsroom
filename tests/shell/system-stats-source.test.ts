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
    expect(source).toMatch(/systemQueueSnapshot\(\s*"event-commentary"/);
    expect(source).toContain("eventCommentaryPending");
    expect(source).toContain("EVENT_COMMENTARY_CRON_RECENCY_HOURS");
    expect(source).toContain("COALESCE(${clusters.latestMemberAt}, ${clusters.firstSeenAt})");
    expect(source).toContain("make_interval(hours => ${EVENT_COMMENTARY_CRON_RECENCY_HOURS})");
  });

  it("keeps queue display metadata in the shared queue contract", () => {
    expect(source).toContain("@/lib/shell/system-queues");
    expect(source).toContain("systemQueueSnapshot(");
    expect(source).not.toContain('rate: "≈ 60/15m"');
    expect(source).not.toContain('rate: "≈ 200/30m"');
    expect(source).not.toContain('rate: "≈ 8/30m"');
    expect(source).not.toContain('rate: "≈ 120/15m"');
  });
});
