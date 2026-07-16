import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "@/db/schema";
import {
  createNewsletterApi,
  NEWSLETTER_SUBSCRIBE_RATE_LIMIT,
} from "@/lib/email/api";
import { migrateNewsletterEmail } from "@/lib/email/migration";
import type { EmailDb } from "@/lib/email/subscribers";
import { subscribeOrRevive, confirmByToken } from "@/lib/email/subscribers";
import type { OutgoingEmail, ResendClient } from "@/lib/email/resend";
import { __resetPublicBuckets } from "@/lib/rate-limit/public";

let client: Client;
let dbc: EmailDb;
let fixtureRoot: string;
let sent: OutgoingEmail[];

const fakeResend: ResendClient = {
  async sendEmail(email) {
    sent.push(email);
    return { id: `re_${sent.length}` };
  },
  async sendBatch(emails) {
    sent.push(...emails);
    return { ids: emails.map((_, i) => `re_${i}`) };
  },
};

function api() {
  return createNewsletterApi({ dbc, resend: fakeResend });
}

function subscribeRequest(body: unknown, ip = "1.2.3.4"): Request {
  return new Request("https://news.ax0x.ai/api/newsletter/subscribe", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), "newsroom-email-api-"));
  client = createClient({ url: `file:${join(fixtureRoot, "api.sqlite")}` });
  await migrateNewsletterEmail(client);
  dbc = drizzle(client, { schema, casing: "snake_case" }) as EmailDb;
  sent = [];
  __resetPublicBuckets();
});

afterEach(async () => {
  client.close();
  await rm(fixtureRoot, { recursive: true, force: true });
});

describe("POST /api/newsletter/subscribe", () => {
  test("valid email → 200 {ok:true} and a confirm email", async () => {
    const response = await api().subscribe(
      subscribeRequest({ email: "reader@example.com" }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("reader@example.com");
    expect(sent[0]?.html).toContain("/api/newsletter/confirm?token=");
  });

  test("invalid email → 400 with zod envelope", async () => {
    const response = await api().subscribe(
      subscribeRequest({ email: "not-an-email" }),
    );
    expect(response.status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  test("no enumeration oracle: new, duplicate-pending, active, and bounced all return the same body", async () => {
    const bodies: string[] = [];
    for (let round = 0; round < 2; round++) {
      const response = await api().subscribe(
        subscribeRequest({ email: "dup@example.com" }, `10.0.0.${round}`),
      );
      bodies.push(await response.text());
      expect(response.status).toBe(200);
    }
    const created = await subscribeOrRevive({ email: "active@example.com" }, dbc);
    await confirmByToken(created.subscriber!.confirmToken, dbc);
    const activeResponse = await api().subscribe(
      subscribeRequest({ email: "active@example.com" }, "10.0.1.1"),
    );
    bodies.push(await activeResponse.text());

    await client.execute(
      "UPDATE newsletter_subscribers SET status = 'bounced' WHERE email = 'active@example.com'",
    );
    const bouncedResponse = await api().subscribe(
      subscribeRequest({ email: "active@example.com" }, "10.0.1.2"),
    );
    bodies.push(await bouncedResponse.text());

    expect(new Set(bodies).size).toBe(1);
  });

  test("active and suppressed subscribers get NO email", async () => {
    const created = await subscribeOrRevive({ email: "a@example.com" }, dbc);
    await confirmByToken(created.subscriber!.confirmToken, dbc);
    sent = [];
    await api().subscribe(subscribeRequest({ email: "a@example.com" }));
    expect(sent).toHaveLength(0);
  });

  test("kind preferences flow through", async () => {
    await api().subscribe(
      subscribeRequest({
        email: "prefs@example.com",
        wantsDailyDigest: false,
        wantsDailyFeatured: true,
      }),
    );
    const stored = await client.execute(
      "SELECT wants_daily_digest, wants_daily_featured FROM newsletter_subscribers WHERE email = 'prefs@example.com'",
    );
    expect(Number(stored.rows[0]?.wants_daily_digest)).toBe(0);
    expect(Number(stored.rows[0]?.wants_daily_featured)).toBe(1);
  });

  test("a confirm-send failure still returns the uniform 200 (no status oracle)", async () => {
    const failingResend: ResendClient = {
      async sendEmail() {
        throw new Error("resend outage");
      },
      async sendBatch() {
        throw new Error("resend outage");
      },
    };
    const response = await createNewsletterApi({
      dbc,
      resend: failingResend,
    }).subscribe(subscribeRequest({ email: "fail@example.com" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  test("concurrent subscribes for the same new email never 500", async () => {
    const [first, second] = await Promise.all([
      api().subscribe(subscribeRequest({ email: "race@example.com" }, "8.8.1.1")),
      api().subscribe(subscribeRequest({ email: "race@example.com" }, "8.8.1.2")),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const count = await client.execute(
      "SELECT COUNT(*) AS n FROM newsletter_subscribers WHERE email = 'race@example.com'",
    );
    expect(Number(count.rows[0]?.n)).toBe(1);
  });

  test("rate limit returns 429 past the family max for one IP", async () => {
    const max = NEWSLETTER_SUBSCRIBE_RATE_LIMIT.max;
    let lastStatus = 0;
    for (let i = 0; i <= max; i++) {
      const response = await api().subscribe(
        subscribeRequest({ email: `user${i}@example.com` }, "9.9.9.9"),
      );
      lastStatus = response.status;
    }
    expect(lastStatus).toBe(429);
  });
});

describe("GET /api/newsletter/confirm", () => {
  test("valid token redirects to status=confirmed and activates", async () => {
    await api().subscribe(subscribeRequest({ email: "c@example.com" }));
    const token = /confirm\?token=([A-Za-z0-9_-]+)/.exec(
      sent[0]?.html ?? "",
    )?.[1];
    const response = await api().confirm(
      new Request(`https://news.ax0x.ai/api/newsletter/confirm?token=${token}`),
    );
    expect(response.status).toBeGreaterThanOrEqual(302);
    expect(response.headers.get("location")).toContain(
      "/zh/newsletter?status=confirmed",
    );
    const stored = await client.execute(
      "SELECT status FROM newsletter_subscribers WHERE email = 'c@example.com'",
    );
    expect(stored.rows[0]?.status).toBe("active");
  });

  test("unknown or missing token redirects to status=invalid", async () => {
    const bad = await api().confirm(
      new Request("https://news.ax0x.ai/api/newsletter/confirm?token=nope"),
    );
    expect(bad.headers.get("location")).toContain("status=invalid");
    const missing = await api().confirm(
      new Request("https://news.ax0x.ai/api/newsletter/confirm"),
    );
    expect(missing.headers.get("location")).toContain("status=invalid");
  });
});

describe("unsubscribe", () => {
  async function activeUnsubToken(email: string): Promise<string> {
    const created = await subscribeOrRevive({ email }, dbc);
    await confirmByToken(created.subscriber!.confirmToken, dbc);
    const stored = await client.execute({
      sql: "SELECT unsubscribe_token FROM newsletter_subscribers WHERE email = ?",
      args: [email],
    });
    return String(stored.rows[0]?.unsubscribe_token);
  }

  test("GET valid token redirects to status=unsubscribed and flips status", async () => {
    const token = await activeUnsubToken("u@example.com");
    const response = await api().unsubscribe(
      new Request(
        `https://news.ax0x.ai/api/newsletter/unsubscribe?token=${token}`,
      ),
    );
    expect(response.headers.get("location")).toContain(
      "/zh/newsletter?status=unsubscribed",
    );
    const stored = await client.execute(
      "SELECT status FROM newsletter_subscribers WHERE email = 'u@example.com'",
    );
    expect(stored.rows[0]?.status).toBe("unsubscribed");
  });

  test("GET unknown token redirects to status=invalid", async () => {
    const response = await api().unsubscribe(
      new Request("https://news.ax0x.ai/api/newsletter/unsubscribe?token=x"),
    );
    expect(response.headers.get("location")).toContain("status=invalid");
  });

  test("POST (RFC 8058 One-Click) returns 200 and unsubscribes", async () => {
    const token = await activeUnsubToken("oneclick@example.com");
    const response = await api().unsubscribeOneClick(
      new Request(
        `https://news.ax0x.ai/api/newsletter/unsubscribe?token=${token}`,
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: "List-Unsubscribe=One-Click",
        },
      ),
    );
    expect(response.status).toBe(200);
    const stored = await client.execute(
      "SELECT status FROM newsletter_subscribers WHERE email = 'oneclick@example.com'",
    );
    expect(stored.rows[0]?.status).toBe("unsubscribed");
  });

  test("POST with unknown token still returns 200 (no oracle for mailbox providers)", async () => {
    const response = await api().unsubscribeOneClick(
      new Request("https://news.ax0x.ai/api/newsletter/unsubscribe?token=x", {
        method: "POST",
      }),
    );
    expect(response.status).toBe(200);
  });
});
