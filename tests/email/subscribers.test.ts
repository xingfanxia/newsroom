import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "@/db/schema";
import { migrateNewsletterEmail } from "@/lib/email/migration";
import {
  confirmByToken,
  listSendRecipients,
  recordSends,
  subscribeOrRevive,
  unsubscribeByToken,
  type EmailDb,
} from "@/lib/email/subscribers";

let client: Client;
let dbc: EmailDb;
let fixtureRoot: string;

beforeEach(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), "newsroom-subscribers-"));
  client = createClient({
    url: `file:${join(fixtureRoot, "subscribers.sqlite")}`,
  });
  await migrateNewsletterEmail(client);
  dbc = drizzle(client, { schema, casing: "snake_case" }) as EmailDb;
});

afterEach(async () => {
  client.close();
  await rm(fixtureRoot, { recursive: true, force: true });
});

async function row(email: string) {
  const result = await client.execute({
    sql: "SELECT * FROM newsletter_subscribers WHERE email = ?",
    args: [email],
  });
  return result.rows[0] ?? null;
}

describe("subscribeOrRevive", () => {
  test("new email creates a pending row with tokens and lowercased email", async () => {
    const result = await subscribeOrRevive(
      { email: "Reader@Example.COM", locale: "zh" },
      dbc,
    );
    expect(result.outcome).toBe("created");
    expect(result.subscriber?.confirmToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const stored = await row("reader@example.com");
    expect(stored?.status).toBe("pending");
    expect(String(stored?.email)).toBe("reader@example.com");
    expect(Number(stored?.wants_daily_digest)).toBe(1);
    expect(Number(stored?.wants_daily_featured)).toBe(1);
  });

  test("kind preferences are stored from the request", async () => {
    await subscribeOrRevive(
      { email: "a@example.com", wantsDailyDigest: true, wantsDailyFeatured: false },
      dbc,
    );
    const stored = await row("a@example.com");
    expect(Number(stored?.wants_daily_digest)).toBe(1);
    expect(Number(stored?.wants_daily_featured)).toBe(0);
  });

  test("pending re-subscribe regenerates the confirm token (pending_again)", async () => {
    const first = await subscribeOrRevive({ email: "a@example.com" }, dbc);
    const second = await subscribeOrRevive({ email: "A@EXAMPLE.com" }, dbc);
    expect(second.outcome).toBe("pending_again");
    expect(second.subscriber?.confirmToken).not.toBe(
      first.subscriber?.confirmToken,
    );
    const count = await client.execute(
      "SELECT COUNT(*) AS n FROM newsletter_subscribers",
    );
    expect(Number(count.rows[0]?.n)).toBe(1);
  });

  test("active re-subscribe is a no-op without pref mutation (already_active)", async () => {
    const created = await subscribeOrRevive({ email: "a@example.com" }, dbc);
    await confirmByToken(created.subscriber!.confirmToken, dbc);
    const again = await subscribeOrRevive(
      { email: "a@example.com", wantsDailyDigest: false },
      dbc,
    );
    expect(again.outcome).toBe("already_active");
    const stored = await row("a@example.com");
    expect(stored?.status).toBe("active");
    // A third party must not be able to flip prefs without token auth.
    expect(Number(stored?.wants_daily_digest)).toBe(1);
  });

  test("unsubscribed re-subscribe revives the SAME row: pending again, new confirm token, unsubscribe token kept", async () => {
    const created = await subscribeOrRevive({ email: "a@example.com" }, dbc);
    await confirmByToken(created.subscriber!.confirmToken, dbc);
    const before = await row("a@example.com");
    await unsubscribeByToken(String(before?.unsubscribe_token), dbc);

    const revived = await subscribeOrRevive(
      { email: "a@example.com", wantsDailyFeatured: false },
      dbc,
    );
    expect(revived.outcome).toBe("revived");
    const stored = await row("a@example.com");
    expect(stored?.status).toBe("pending");
    expect(String(stored?.unsubscribe_token)).toBe(
      String(before?.unsubscribe_token),
    );
    expect(String(stored?.confirm_token)).not.toBe(
      String(before?.confirm_token),
    );
    expect(Number(stored?.wants_daily_featured)).toBe(0);
    const count = await client.execute(
      "SELECT COUNT(*) AS n FROM newsletter_subscribers",
    );
    expect(Number(count.rows[0]?.n)).toBe(1);
  });

  test("bounced rows are suppressed — not revived by public subscribe", async () => {
    await subscribeOrRevive({ email: "a@example.com" }, dbc);
    await client.execute(
      "UPDATE newsletter_subscribers SET status = 'bounced' WHERE email = 'a@example.com'",
    );
    const result = await subscribeOrRevive({ email: "a@example.com" }, dbc);
    expect(result.outcome).toBe("suppressed");
    const stored = await row("a@example.com");
    expect(stored?.status).toBe("bounced");
  });

  test("mixed-case lookup hits the NOCASE row (no duplicate insert)", async () => {
    await subscribeOrRevive({ email: "MiXeD@Example.com" }, dbc);
    const result = await subscribeOrRevive({ email: "mixed@example.COM" }, dbc);
    expect(result.outcome).toBe("pending_again");
  });
});

describe("confirmByToken", () => {
  test("flips pending to active and stamps confirmed_at", async () => {
    const created = await subscribeOrRevive({ email: "a@example.com" }, dbc);
    const confirmed = await confirmByToken(
      created.subscriber!.confirmToken,
      dbc,
    );
    expect(confirmed?.status).toBe("active");
    const stored = await row("a@example.com");
    expect(stored?.status).toBe("active");
    expect(stored?.confirmed_at).not.toBeNull();
  });

  test("is idempotent for an already-active token and null for unknown tokens", async () => {
    const created = await subscribeOrRevive({ email: "a@example.com" }, dbc);
    await confirmByToken(created.subscriber!.confirmToken, dbc);
    const again = await confirmByToken(created.subscriber!.confirmToken, dbc);
    expect(again?.status).toBe("active");
    expect(await confirmByToken("unknown-token", dbc)).toBeNull();
  });

  test("does not resurrect an unsubscribed row via a stale confirm token", async () => {
    const created = await subscribeOrRevive({ email: "a@example.com" }, dbc);
    await confirmByToken(created.subscriber!.confirmToken, dbc);
    const stored = await row("a@example.com");
    await unsubscribeByToken(String(stored?.unsubscribe_token), dbc);
    const result = await confirmByToken(created.subscriber!.confirmToken, dbc);
    expect(result).toBeNull();
    expect((await row("a@example.com"))?.status).toBe("unsubscribed");
  });
});

describe("unsubscribeByToken", () => {
  test("flips to unsubscribed, stamps unsubscribed_at, idempotent, unknown → null", async () => {
    const created = await subscribeOrRevive({ email: "a@example.com" }, dbc);
    await confirmByToken(created.subscriber!.confirmToken, dbc);
    const stored = await row("a@example.com");
    const token = String(stored?.unsubscribe_token);

    const first = await unsubscribeByToken(token, dbc);
    expect(first?.status).toBe("unsubscribed");
    const second = await unsubscribeByToken(token, dbc);
    expect(second?.status).toBe("unsubscribed");
    expect((await row("a@example.com"))?.unsubscribed_at).not.toBeNull();
    expect(await unsubscribeByToken("unknown-token", dbc)).toBeNull();
  });
});

describe("listSendRecipients + recordSends", () => {
  async function activate(email: string, wants: { digest: boolean; featured: boolean }) {
    const created = await subscribeOrRevive(
      {
        email,
        wantsDailyDigest: wants.digest,
        wantsDailyFeatured: wants.featured,
      },
      dbc,
    );
    await confirmByToken(created.subscriber!.confirmToken, dbc);
  }

  test("returns only active subscribers wanting the kind with no ledger row for the period", async () => {
    await activate("digest-only@example.com", { digest: true, featured: false });
    await activate("both@example.com", { digest: true, featured: true });
    await subscribeOrRevive({ email: "pending@example.com" }, dbc); // never confirmed

    const recipients = await listSendRecipients("daily_digest", "2026-07-16", dbc);
    expect(recipients.map((r) => r.email).sort()).toEqual([
      "both@example.com",
      "digest-only@example.com",
    ]);
    expect(recipients[0]?.unsubscribeToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const featuredRecipients = await listSendRecipients(
      "daily_featured",
      "2026-07-16",
      dbc,
    );
    expect(featuredRecipients.map((r) => r.email)).toEqual([
      "both@example.com",
    ]);
  });

  test("a 'failed' ledger row keeps the recipient eligible; a later 'sent' overwrites it exactly once", async () => {
    await activate("retry@example.com", { digest: true, featured: false });
    const [recipient] = await listSendRecipients("daily_digest", "2026-07-16", dbc);
    await recordSends(
      [
        {
          emailKind: "daily_digest",
          periodKey: "2026-07-16",
          subscriberId: recipient!.id,
          status: "failed",
          error: "resend outage",
        },
      ],
      dbc,
    );
    // Failed row does NOT suppress the retry.
    const retryList = await listSendRecipients("daily_digest", "2026-07-16", dbc);
    expect(retryList.map((r) => r.email)).toEqual(["retry@example.com"]);
    // Success overwrites the failed row instead of throwing or duplicating.
    await recordSends(
      [
        {
          emailKind: "daily_digest",
          periodKey: "2026-07-16",
          subscriberId: recipient!.id,
          status: "sent",
          resendId: "re_retry",
        },
      ],
      dbc,
    );
    expect(await listSendRecipients("daily_digest", "2026-07-16", dbc)).toEqual([]);
    const rows = await client.execute(
      "SELECT status, resend_id, error FROM newsletter_email_sends",
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.status).toBe("sent");
    expect(rows.rows[0]?.resend_id).toBe("re_retry");
  });

  test("'sent' is sticky — a later 'failed' record cannot re-open a delivered recipient", async () => {
    await activate("sticky@example.com", { digest: true, featured: false });
    const [recipient] = await listSendRecipients("daily_digest", "2026-07-16", dbc);
    await recordSends(
      [
        {
          emailKind: "daily_digest",
          periodKey: "2026-07-16",
          subscriberId: recipient!.id,
          status: "sent",
          resendId: "re_ok",
        },
      ],
      dbc,
    );
    await recordSends(
      [
        {
          emailKind: "daily_digest",
          periodKey: "2026-07-16",
          subscriberId: recipient!.id,
          status: "failed",
          error: "late failure report",
        },
      ],
      dbc,
    );
    expect(await listSendRecipients("daily_digest", "2026-07-16", dbc)).toEqual([]);
    const rows = await client.execute(
      "SELECT status FROM newsletter_email_sends",
    );
    expect(rows.rows[0]?.status).toBe("sent");
  });

  test("recordSends marks recipients sent; the next list excludes them; duplicate records are ignored", async () => {
    await activate("a@example.com", { digest: true, featured: true });
    const [recipient] = await listSendRecipients("daily_digest", "2026-07-16", dbc);
    await recordSends(
      [
        {
          emailKind: "daily_digest",
          periodKey: "2026-07-16",
          subscriberId: recipient!.id,
          status: "sent",
          resendId: "re_1",
        },
      ],
      dbc,
    );
    expect(await listSendRecipients("daily_digest", "2026-07-16", dbc)).toEqual([]);
    // Same period+kind+subscriber again (retried chunk) must not throw.
    await recordSends(
      [
        {
          emailKind: "daily_digest",
          periodKey: "2026-07-16",
          subscriberId: recipient!.id,
          status: "sent",
          resendId: "re_dup",
        },
      ],
      dbc,
    );
    // A NEW period sends again.
    expect(
      (await listSendRecipients("daily_digest", "2026-07-17", dbc)).map(
        (r) => r.email,
      ),
    ).toEqual(["a@example.com"]);
  });
});
