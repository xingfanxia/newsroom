#!/usr/bin/env bun
/**
 * Dev-only seed — creates a synthetic editor user + 10 feedback rows so the
 * M4 iteration agent has something to iterate on before real traffic arrives.
 * Idempotent via unique(itemId,userId,vote); re-running is a no-op.
 *
 * Usage: `bun --env-file=.env.local scripts/ops/seed-feedback-fixture.ts`
 * Refuses to run in production unless ALLOW_FIXTURE_SEED=1.
 */
import { sql } from "drizzle-orm";
import { closeDb, db, schema } from "@/db/client";

const FIXTURE_USER_ID = "fixture-editor-00000001";
const FIXTURE_EMAIL = "fixture-editor@example.com";

if (
  process.env.NODE_ENV === "production" &&
  process.env.ALLOW_FIXTURE_SEED !== "1"
) {
  console.error(
    "refusing to seed in production; set ALLOW_FIXTURE_SEED=1 to override",
  );
  process.exit(1);
}

const fixtures: { verdict: "up" | "down"; note: string }[] = [
  { verdict: "up", note: "最近 Claude 的内容的权重可以再提高一些" },
  { verdict: "down", note: "太偏专业开发向，我们的读者不是攻城狮" },
  { verdict: "up", note: "小米/百度/阿里发布新模型，该给高分，别歧视国产" },
  { verdict: "down", note: "Sora 已经不是热点了，这类 how-to 应该降权" },
  { verdict: "down", note: "CVE 逆向、底层调优之类的过于技术" },
  { verdict: "down", note: "AI + 理论物理的论文，离我们受众太远" },
  { verdict: "up", note: "Claude 电脑控制这类 agent 能力，现在节点应该 90+" },
  { verdict: "up", note: "" },
  { verdict: "down", note: "学术向的 benchmark paper，不是大家关心的" },
  { verdict: "down", note: "云厂商的「在 X Cloud 上用 AI」案例，纯广告" },
];

const client = db();

await client
  .insert(schema.users)
  .values({
    id: FIXTURE_USER_ID,
    email: FIXTURE_EMAIL,
    role: "editor",
  })
  .onConflictDoUpdate({
    target: schema.users.id,
    set: { updatedAt: sql`now()` },
  });
console.log(`[seed] user ${FIXTURE_EMAIL} ok`);

const pool = await client
  .select({ id: schema.items.id, title: schema.items.title })
  .from(schema.items)
  .where(sql`${schema.items.tier} IN ('featured', 'p1')`)
  .orderBy(sql`${schema.items.publishedAt} DESC`)
  .limit(fixtures.length * 2);

if (pool.length < fixtures.length) {
  console.error(
    `need ≥${fixtures.length} featured/p1 items, got ${pool.length}`,
  );
  await closeDb();
  process.exit(1);
}

let inserted = 0;
for (let i = 0; i < fixtures.length; i++) {
  const f = fixtures[i];
  const target = pool[i];
  const r = await client
    .insert(schema.feedback)
    .values({
      itemId: target.id,
      userId: FIXTURE_USER_ID,
      vote: f.verdict,
      note: f.note.length > 0 ? f.note : null,
    })
    .onConflictDoNothing()
    .returning();
  if (r.length > 0) {
    inserted++;
    console.log(`  [+] ${f.verdict.toUpperCase()} item=${target.id} — ${target.title.slice(0, 50)}`);
  }
}
console.log(
  `[seed] feedback: ${inserted} new / ${fixtures.length - inserted} already present`,
);
await closeDb();
