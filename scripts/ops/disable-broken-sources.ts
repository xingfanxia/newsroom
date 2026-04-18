#!/usr/bin/env bun
/**
 * One-shot maintenance script — flips `enabled: true` → `enabled: false` for
 * a hard-coded list of broken / stale / unsupported sources and appends a
 * `notes` line explaining why.
 *
 * Idempotent: re-running is a no-op once sources are disabled.
 *
 * Usage: bun scripts/ops/disable-broken-sources.ts
 *        (then: `bun scripts/ops/seed-sources.ts` to apply to the DB)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const disables: { id: string; note: string }[] = [
  // rsshub.app is 403-blocking our User-Agent entirely
  { id: "36kr-ai", note: "Disabled 2026-04-18 — rsshub.app 403-blocks us. See 36kr-w2r (feedx) alt." },
  { id: "huxiu-ai", note: "Disabled 2026-04-18 — rsshub.app 403-blocks us." },
  { id: "sspai-matrix", note: "Disabled 2026-04-18 — rsshub.app 403-blocks us. See sspai-direct alt." },
  { id: "jiqizhixin", note: "Disabled 2026-04-18 — rsshub.app 403-blocks us. See jiqizhixin-w2r alt." },
  { id: "qbitai", note: "Disabled 2026-04-18 — rsshub.app 403-blocks us. See qbitai-w2r alt." },
  { id: "zhihu-hotlist", note: "Disabled 2026-04-18 — rsshub.app 403-blocks us. No clean alt." },
  { id: "wechat-jiqizhixin-mp", note: "Disabled 2026-04-18 — rsshub.app 403-blocks us. See jiqizhixin-w2r alt." },
  // Direct-RSS feeds gone / moved
  { id: "thebatch", note: "Disabled 2026-04-18 — deeplearning.ai/the-batch/feed/ returns 404." },
  { id: "github-trending", note: "Disabled 2026-04-18 — GitHub no longer serves .atom; bot-walled HTML returned." },
  { id: "rest-of-world", note: "Disabled 2026-04-18 — /feed/rss/ redirects to /lander JS challenge." },
  // Stale-but-green (fetcher sees ok but no new items)
  { id: "coolshell-cn", note: "Disabled 2026-04-18 — site frozen in memoriam; no posts since May 2023." },
  { id: "huxiu-feedx", note: "Disabled 2026-04-18 — feedx mirror stopped updating Aug 2024." },
  { id: "jiemoren-macro-w2r", note: "Disabled 2026-04-18 — WeChat2RSS account defunct since Jan 2025." },
  { id: "thepaper-feedx", note: "Disabled 2026-04-18 — feedx mirror stale 4 months. Revisit if needed." },
  // Unsupported `kind` — can't fetch until adapter lands
  { id: "anthropic-news", note: "Disabled 2026-04-18 — kind='scrape' not implemented in the fetcher." },
  { id: "huggingface-papers", note: "Disabled 2026-04-18 — kind='scrape' not implemented." },
  { id: "hf-trending-models", note: "Disabled 2026-04-18 — kind='api' not implemented (HF trending API adapter TBD)." },
  { id: "deepseek-hf", note: "Disabled 2026-04-18 — kind='scrape' not implemented." },
  { id: "qwen-hf", note: "Disabled 2026-04-18 — kind='scrape' not implemented." },
  // Obsolete / superseded
  { id: "x-ai-watchlist", note: "Disabled 2026-04-18 — superseded by 7 per-handle x-api sources." },
];

const path = resolve(process.cwd(), "lib/sources/catalog.ts");
let src = readFileSync(path, "utf8");
let changed = 0;

for (const d of disables) {
  // Match the full block from `id: "<id>",` through the next `enabled: true,`
  // line. Require id line to be the start of a block — anchored on 4-space
  // indent to avoid colliding with comments.
  const rx = new RegExp(
    String.raw`(\n\s*\{\s*\n\s*id:\s*"` +
      d.id.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&") +
      String.raw`",\n(?:[^\n]*\n){1,20}?)(\s+)enabled:\s*true,(\n)`,
    "m",
  );
  const match = src.match(rx);
  if (!match) {
    console.log(`[skip] ${d.id} — already disabled OR not found`);
    continue;
  }
  // Check if block already has a Disabled note — idempotent skip.
  const blockText = match[1];
  if (/notes:\s*"[^"]*Disabled/.test(blockText)) {
    console.log(`[skip] ${d.id} — already has 'Disabled' note`);
    continue;
  }
  const indent = match[2];
  // If the block already has a `notes` field (without "Disabled"), merge rather
  // than add a duplicate — TS chokes on repeated object-literal keys.
  const existingNotes = blockText.match(/notes:\s*"([^"]*)"/);
  if (existingNotes) {
    const merged = `Disabled 2026-04-18 — ${existingNotes[1]}. ${d.note.replace(/^Disabled [0-9-]+\s*—\s*/, "")}`;
    src = src.replace(
      rx,
      (_m, block, ind, nl) => {
        const withDisabled = block.replace(
          /notes:\s*"[^"]*"/,
          `notes: ${JSON.stringify(merged)}`,
        );
        return `${withDisabled}${ind}enabled: false,${nl}`;
      },
    );
  } else {
    src = src.replace(
      rx,
      `$1${indent}enabled: false,\n${indent}notes: ${JSON.stringify(d.note)},$3`,
    );
  }
  changed++;
  console.log(`[ok]   ${d.id}`);
}

writeFileSync(path, src);
console.log(`\npatched ${changed}/${disables.length} sources`);
