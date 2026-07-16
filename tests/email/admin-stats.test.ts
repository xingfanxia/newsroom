import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "@/db/schema";
import { getNewsletterAdminStats } from "@/lib/email/admin-stats";
import { migrateNewsletterEmail } from "@/lib/email/migration";
import {
  confirmByToken,
  recordSends,
  subscribeOrRevive,
  unsubscribeByToken,
  type EmailDb,
} from "@/lib/email/subscribers";

let client: Client;
let dbc: EmailDb;
let fixtureRoot: string;

beforeEach(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), "newsroom-admin-stats-"));
  client = createClient({ url: `file:${join(fixtureRoot, "stats.sqlite")}` });
  await migrateNewsletterEmail(client);
  dbc = drizzle(client, { schema, casing: "snake_case" }) as EmailDb;
});

afterEach(async () => {
  client.close();
  await rm(fixtureRoot, { recursive: true, force: true });
});

async function subscriberId(email: string): Promise<number> {
  const row = await client.execute({
    sql: "SELECT id FROM newsletter_subscribers WHERE email = ?",
    args: [email],
  });
  return Number(row.rows[0]?.id);
}

describe("getNewsletterAdminStats", () => {
  test("counts subscribers by status and kind preference", async () => {
    const active = await subscribeOrRevive(
      { email: "active@example.com", wantsDailyFeatured: false },
      dbc,
    );
    await confirmByToken(active.subscriber!.confirmToken, dbc);
    await subscribeOrRevive({ email: "pending@example.com" }, dbc);
    const gone = await subscribeOrRevive({ email: "gone@example.com" }, dbc);
    await confirmByToken(gone.subscriber!.confirmToken, dbc);
    const goneRow = await client.execute(
      "SELECT unsubscribe_token FROM newsletter_subscribers WHERE email = 'gone@example.com'",
    );
    await unsubscribeByToken(String(goneRow.rows[0]?.unsubscribe_token), dbc);

    const stats = await getNewsletterAdminStats(dbc);
    expect(stats.subscribers.total).toBe(3);
    expect(stats.subscribers.active).toBe(1);
    expect(stats.subscribers.pending).toBe(1);
    expect(stats.subscribers.unsubscribed).toBe(1);
    expect(stats.subscribers.bounced).toBe(0);
    // Kind preferences count ACTIVE subscribers only.
    expect(stats.subscribers.activeWantsDigest).toBe(1);
    expect(stats.subscribers.activeWantsFeatured).toBe(0);
  });

  test("aggregates the send ledger per period and kind, newest first", async () => {
    const created = await subscribeOrRevive({ email: "a@example.com" }, dbc);
    await confirmByToken(created.subscriber!.confirmToken, dbc);
    const id = await subscriberId("a@example.com");
    await recordSends(
      [
        { emailKind: "daily_digest", periodKey: "2026-07-15", subscriberId: id, status: "sent", resendId: "re_1" },
        { emailKind: "daily_digest", periodKey: "2026-07-16", subscriberId: id, status: "sent", resendId: "re_2" },
        { emailKind: "daily_featured", periodKey: "2026-07-16", subscriberId: id, status: "sent", resendId: "re_3" },
      ],
      dbc,
    );

    const stats = await getNewsletterAdminStats(dbc);
    expect(stats.totals.delivered).toBe(3);
    expect(stats.totals.failed).toBe(0);
    expect(stats.sends[0]?.periodKey).toBe("2026-07-16");
    const day16 = stats.sends.filter((s) => s.periodKey === "2026-07-16");
    expect(day16.map((s) => [s.kind, s.sent])).toEqual([
      ["daily_digest", 1],
      ["daily_featured", 1],
    ]);
    expect(
      stats.sends.find((s) => s.periodKey === "2026-07-15")?.sent,
    ).toBe(1);
  });

  test("lists recent subscribers newest-first with status", async () => {
    await subscribeOrRevive({ email: "first@example.com" }, dbc);
    await subscribeOrRevive({ email: "second@example.com" }, dbc);
    const stats = await getNewsletterAdminStats(dbc);
    expect(stats.recentSubscribers.length).toBe(2);
    expect(stats.recentSubscribers.map((s) => s.email)).toContain(
      "second@example.com",
    );
    expect(stats.recentSubscribers[0]?.status).toBe("pending");
  });

  test("is empty-safe before any subscribers exist", async () => {
    const stats = await getNewsletterAdminStats(dbc);
    expect(stats.subscribers.total).toBe(0);
    expect(stats.sends).toEqual([]);
    expect(stats.recentSubscribers).toEqual([]);
    expect(stats.totals).toEqual({ delivered: 0, failed: 0 });
  });
});
