import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "@/db/schema";
import { migrateNewsletterEmail } from "@/lib/email/migration";
import type { OutgoingEmail, ResendClient } from "@/lib/email/resend";
import {
  confirmByToken,
  subscribeOrRevive,
  type EmailDb,
} from "@/lib/email/subscribers";
import { runNewsletterSend } from "@/workers/newsletter/send";

const BASE_SCHEMA = [
  `CREATE TABLE sources (
    id TEXT PRIMARY KEY, name_en TEXT NOT NULL, name_zh TEXT NOT NULL,
    url TEXT NOT NULL
  )`,
  `CREATE TABLE clusters (
    id INTEGER PRIMARY KEY, lead_item_id INTEGER NOT NULL,
    canonical_title_zh TEXT, summary_zh TEXT, editor_analysis_zh TEXT,
    importance INTEGER, event_tier TEXT
  )`,
  `CREATE TABLE items (
    id INTEGER PRIMARY KEY, source_id TEXT NOT NULL, cluster_id INTEGER,
    title TEXT NOT NULL, title_zh TEXT, summary_zh TEXT,
    editor_analysis_zh TEXT, url TEXT NOT NULL,
    tier TEXT, importance INTEGER,
    published_at INTEGER NOT NULL, created_at INTEGER NOT NULL,
    enriched_at INTEGER
  )`,
  `CREATE TABLE newsletters (
    id INTEGER PRIMARY KEY, kind TEXT NOT NULL, locale TEXT NOT NULL,
    period_start INTEGER NOT NULL, period_end INTEGER NOT NULL,
    column_title TEXT, column_summary_md TEXT, column_narrative_md TEXT,
    column_featured_item_ids TEXT, column_theme_tag TEXT,
    item_ids TEXT, story_count INTEGER NOT NULL DEFAULT 0,
    published_at INTEGER NOT NULL
  )`,
] as const;

// Send fires at 05:40 UTC; the column window ended at 05:00 the same day.
const NOW = new Date("2026-07-16T05:40:00Z");
const WINDOW_START = new Date("2026-07-15T05:00:00Z");
const WINDOW_END = new Date("2026-07-16T05:00:00Z");
const PERIOD_KEY = "2026-07-16";

let client: Client;
let dbc: EmailDb;
let fixtureRoot: string;
let batches: Array<{ emails: OutgoingEmail[]; idempotencyKey?: string }>;
let failOnBatch: ((batchIndex: number) => boolean) | null;

const fakeResend: ResendClient = {
  async sendEmail() {
    throw new Error("send worker must use sendBatch");
  },
  async sendBatch(emails, opts) {
    const index = batches.length;
    if (failOnBatch?.(index)) {
      throw new Error(`injected batch failure #${index}`);
    }
    batches.push({ emails, idempotencyKey: opts?.idempotencyKey });
    return { ids: emails.map((_, i) => `re_${index}_${i}`) };
  },
};

async function insertColumn(): Promise<void> {
  await client.execute({
    sql: `INSERT INTO newsletters
      (kind, locale, period_start, period_end, column_title,
       column_summary_md, column_narrative_md, column_featured_item_ids,
       column_theme_tag, item_ids, story_count, published_at)
      VALUES ('daily', 'zh', ?, ?, '今天的三件事',
       '开场 **白**。', ?, '[1]', '测试主题', '[1,2]', 2, ?)`,
    args: [
      WINDOW_START.getTime(),
      WINDOW_END.getTime(),
      "## 第一件事\n\n细节见 [#1]。\n\n## 第二件事\n\n正文。",
      WINDOW_END.getTime(),
    ],
  });
}

async function insertFeaturedItems(): Promise<void> {
  await client.execute(
    `INSERT INTO sources (id, name_en, name_zh, url)
     VALUES ('src', 'The Verge', '边缘社', 'https://theverge.com')`,
  );
  await client.execute({
    sql: `INSERT INTO items
      (id, source_id, title, title_zh, summary_zh, editor_analysis_zh, url,
       tier, importance, published_at, created_at, enriched_at)
      VALUES
      (1, 'src', 'Story One', '第一条', '摘要一', '锐评一',
       'https://example.com/1', 'featured', 95, ?, ?, ?),
      (2, 'src', 'Story Two', '第二条', '摘要二', '锐评二',
       'https://example.com/2', 'p1', 88, ?, ?, ?),
      (3, 'src', 'Old Story', '旧条', NULL, NULL,
       'https://example.com/old', 'featured', 99, ?, ?, ?)`,
    args: [
      WINDOW_START.getTime() + 1000,
      WINDOW_START.getTime() + 1000,
      WINDOW_START.getTime() + 2000,
      WINDOW_START.getTime() + 1000,
      WINDOW_START.getTime() + 1000,
      WINDOW_START.getTime() + 2000,
      // enriched BEFORE the window → excluded from 精选
      WINDOW_START.getTime() - 5000,
      WINDOW_START.getTime() - 5000,
      WINDOW_START.getTime() - 5000,
    ],
  });
}

async function activateSubscriber(
  email: string,
  wants: { digest?: boolean; featured?: boolean } = {},
): Promise<void> {
  const created = await subscribeOrRevive(
    {
      email,
      wantsDailyDigest: wants.digest ?? true,
      wantsDailyFeatured: wants.featured ?? true,
    },
    dbc,
  );
  await confirmByToken(created.subscriber!.confirmToken, dbc);
}

function run(opts: { dryRun?: boolean } = {}) {
  return runNewsletterSend({
    now: NOW,
    dryRun: opts.dryRun,
    dbc,
    resend: fakeResend,
  });
}

beforeEach(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), "newsroom-send-"));
  client = createClient({ url: `file:${join(fixtureRoot, "send.sqlite")}` });
  await client.batch([...BASE_SCHEMA], "write");
  await migrateNewsletterEmail(client);
  dbc = drizzle(client, { schema, casing: "snake_case" }) as EmailDb;
  batches = [];
  failOnBatch = null;
});

afterEach(async () => {
  client.close();
  await rm(fixtureRoot, { recursive: true, force: true });
});

describe("runNewsletterSend", () => {
  test("happy path: both kinds send, ledger written, unsubscribe personalized", async () => {
    await insertColumn();
    await insertFeaturedItems();
    await activateSubscriber("a@example.com");
    await activateSubscriber("b@example.com", { featured: false });

    const report = await run();
    expect(report.periodKey).toBe(PERIOD_KEY);
    const digest = report.results.find((r) => r.kind === "daily_digest");
    const featured = report.results.find((r) => r.kind === "daily_featured");
    expect(digest?.sent).toBe(2);
    expect(featured?.sent).toBe(1);
    expect(batches).toHaveLength(2);

    const digestBatch = batches[0]!;
    expect(digestBatch.idempotencyKey).toContain(
      `newsroom/daily_digest/${PERIOD_KEY}/`,
    );
    const emailA = digestBatch.emails.find((e) => e.to === "a@example.com")!;
    const emailB = digestBatch.emails.find((e) => e.to === "b@example.com")!;
    expect(emailA.subject).toBe("【AX 日报】今天的三件事");
    // Personalized unsubscribe tokens differ per recipient.
    const tokenOf = (e: OutgoingEmail) =>
      /unsubscribe\?token=([A-Za-z0-9_-]+)/.exec(e.html)?.[1];
    expect(tokenOf(emailA)).toBeTruthy();
    expect(tokenOf(emailA)).not.toBe(tokenOf(emailB));
    // The render-once placeholder must be fully consumed in BOTH parts.
    expect(emailA.html).not.toContain("__NLE_UNSUB_TOKEN");
    expect(emailA.text).not.toContain("__NLE_UNSUB_TOKEN");
    expect(emailA.headers?.["List-Unsubscribe-Post"]).toBe(
      "List-Unsubscribe=One-Click",
    );
    expect(emailA.headers?.["List-Unsubscribe"]).toContain(
      "/api/newsletter/unsubscribe?token=",
    );
    // [#1] resolves to the item's EXTERNAL url.
    expect(emailA.html).toContain("https://example.com/1");
    expect(emailA.html).not.toContain("/zh/items/");

    // 精选 e-mail: window-scoped stories only (old item excluded), 锐评 present.
    const featuredEmail = batches[1]!.emails[0]!;
    expect(featuredEmail.html).toContain("第一条");
    expect(featuredEmail.html).toContain("锐评一");
    expect(featuredEmail.html).not.toContain("旧条");
    expect(featuredEmail.html).not.toContain("__NLE_UNSUB_TOKEN");
    expect(featuredEmail.text).not.toContain("__NLE_UNSUB_TOKEN");

    const ledger = await client.execute(
      "SELECT email_kind, COUNT(*) AS n FROM newsletter_email_sends GROUP BY email_kind ORDER BY email_kind",
    );
    expect(ledger.rows.map((r) => [r.email_kind, Number(r.n)])).toEqual([
      ["daily_digest", 2],
      ["daily_featured", 1],
    ]);
  });

  test("second run is a full no-op (ledger idempotency)", async () => {
    await insertColumn();
    await insertFeaturedItems();
    await activateSubscriber("a@example.com");
    await run();
    batches = [];
    const report = await run();
    expect(batches).toHaveLength(0);
    expect(report.results.every((r) => r.status === "skipped")).toBe(true);
    expect(
      report.results.map((r) => r.reason),
    ).toEqual(["all-sent", "all-sent"]);
  });

  test("no column within 26h skips both kinds", async () => {
    await insertFeaturedItems();
    await activateSubscriber("a@example.com");
    const report = await run();
    expect(report.periodKey).toBeNull();
    expect(report.results.map((r) => r.reason)).toEqual([
      "no-column",
      "no-column",
    ]);
    expect(batches).toHaveLength(0);
  });

  test("no featured items in the window skips 精选 only", async () => {
    await insertColumn();
    await activateSubscriber("a@example.com");
    const report = await run();
    const digest = report.results.find((r) => r.kind === "daily_digest");
    const featured = report.results.find((r) => r.kind === "daily_featured");
    expect(digest?.sent).toBe(1);
    expect(featured?.status).toBe("skipped");
    expect(featured?.reason).toBe("no-featured");
  });

  test("精选 renders one canonical story when any cluster member is in the window", async () => {
    await insertColumn();
    await client.execute(
      `INSERT INTO sources (id, name_en, name_zh, url)
       VALUES ('src', 'The Verge', '边缘社', 'https://theverge.com')`,
    );
    await client.execute({
      sql: `INSERT INTO clusters
        (id, lead_item_id, canonical_title_zh, summary_zh,
         editor_analysis_zh, importance, event_tier)
        VALUES (10, 10, '同一事件的规范标题', '事件级摘要',
                '事件级锐评', 97, 'featured')`,
    });
    await client.execute({
      sql: `INSERT INTO items
        (id, source_id, cluster_id, title, title_zh, summary_zh,
         editor_analysis_zh, url, tier, importance, published_at,
         created_at, enriched_at)
        VALUES
        (10, 'src', 10, 'Old lead', '旧 lead 标题', '旧摘要', '旧锐评',
         'https://example.com/lead', 'featured', 90, ?, ?, ?),
        (11, 'src', 10, 'Recent member', '重复成员标题', '成员摘要', '成员锐评',
         'https://example.com/member', 'p1', 89, ?, ?, ?)`,
      args: [
        WINDOW_START.getTime() - 1000,
        WINDOW_START.getTime() - 1000,
        WINDOW_START.getTime() - 1000,
        WINDOW_START.getTime() + 1000,
        WINDOW_START.getTime() + 1000,
        WINDOW_START.getTime() + 1000,
      ],
    });
    await activateSubscriber("featured@example.com", {
      digest: false,
      featured: true,
    });

    const report = await run();
    expect(
      report.results.find((result) => result.kind === "daily_featured")?.sent,
    ).toBe(1);
    expect(batches).toHaveLength(1);
    const email = batches[0]!.emails[0]!;
    expect(email.html).toContain("同一事件的规范标题");
    expect(email.html).toContain("事件级摘要");
    expect(email.html).toContain("事件级锐评");
    expect(email.html).not.toContain("旧 lead 标题");
    expect(email.html).not.toContain("重复成员标题");
    expect(email.html).not.toContain("https://example.com/member");
  });

  test("no active subscribers reports no-subscribers", async () => {
    await insertColumn();
    await insertFeaturedItems();
    const report = await run();
    expect(report.results.map((r) => r.reason)).toEqual([
      "no-subscribers",
      "no-subscribers",
    ]);
  });

  test("chunks batches at 100 recipients", async () => {
    await insertColumn();
    for (let i = 0; i < 101; i++) {
      await activateSubscriber(`user${i}@example.com`, { featured: false });
    }
    const report = await run();
    const digest = report.results.find((r) => r.kind === "daily_digest");
    expect(digest?.sent).toBe(101);
    expect(batches).toHaveLength(2);
    expect(batches[0]?.emails).toHaveLength(100);
    expect(batches[1]?.emails).toHaveLength(1);
    expect(batches[0]?.idempotencyKey).not.toBe(batches[1]?.idempotencyKey);
  });

  test("a failed chunk records nothing and is retried next run without double-sending", async () => {
    await insertColumn();
    for (let i = 0; i < 101; i++) {
      await activateSubscriber(`user${i}@example.com`, { featured: false });
    }
    failOnBatch = (index) => index === 1;
    const first = await run();
    const digestFirst = first.results.find((r) => r.kind === "daily_digest");
    expect(digestFirst?.sent).toBe(100);
    expect(digestFirst?.failed).toBe(1);

    failOnBatch = null;
    batches = [];
    const second = await run();
    const digestSecond = second.results.find((r) => r.kind === "daily_digest");
    expect(digestSecond?.sent).toBe(1);
    expect(batches).toHaveLength(1);
    expect(batches[0]?.emails).toHaveLength(1);

    const ledger = await client.execute(
      "SELECT COUNT(*) AS n FROM newsletter_email_sends WHERE email_kind = 'daily_digest'",
    );
    expect(Number(ledger.rows[0]?.n)).toBe(101);
  });

  test("dryRun renders and counts but sends nothing and writes no ledger", async () => {
    await insertColumn();
    await insertFeaturedItems();
    await activateSubscriber("a@example.com");
    const report = await run({ dryRun: true });
    expect(report.dryRun).toBe(true);
    const digest = report.results.find((r) => r.kind === "daily_digest");
    expect(digest?.sent).toBe(1);
    expect(batches).toHaveLength(0);
    const ledger = await client.execute(
      "SELECT COUNT(*) AS n FROM newsletter_email_sends",
    );
    expect(Number(ledger.rows[0]?.n)).toBe(0);
  });
});
