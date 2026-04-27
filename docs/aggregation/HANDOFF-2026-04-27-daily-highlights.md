# Newsroom — handoff after daily-highlights default + relax tuning (2026-04-27)

> **Read order**:
> 1. This file (daily-highlights default + threshold/cap tuning)
> 2. `docs/aggregation/HANDOFF-2026-04-26-lead-pick.md` (lead-pick + de-biased title prompt — same PR)
> 3. `docs/aggregation/HANDOFF-2026-04-25-cluster-merge.md` (cluster-merge fix — same PR)

---

## Status: PR #28 merged + Vercel deploy live, daily-highlights tuned

PR #28 (`fix/cluster-merge-prefer-clustered`) merged to main as commit `1678d37` (squash). Production deployed automatically via Vercel.

A follow-up commit (`cf30b3e`) on main relaxed the daily-highlights threshold from "1 per day at importance ≥ 85" to "3 per day at importance ≥ 80" after operator review showed the tighter setting was too sparse.

---

## What ships in this final state

### The home page now defaults to "daily highlights" (top-3 per day)

When a visitor lands on `/zh` (or `/en`) with no calendar filter, no source filter, no tab override (default `tier=featured`), the feed shows:
- **Up to 3 stories per calendar day**
- **Filtered to effective importance ≥ 80** (uses cluster.importance when multi-member, else item.importance)
- **Sorted day-DESC then importance-DESC within day** so the strongest events surface first
- **Browses backward in time** (no 24h hot-window clip — uses `view=archive`)

Drill-ins keep the full chronological feed for their slice — opening `/zh?source=media`, `/zh?date=2026-04-21`, or `/zh?tier=p1` returns every story, not the digest.

### What was tuned (2026-04-27)

**Operator feedback after the initial 1-per-day at imp ≥ 85 default went live:**
> "85 seems too strict — only 1 event per day on default page; want to see about 3 items per day"

Changes in `cf30b3e`:
- `minImportance: 85` → `minImportance: 80` (admits the 80-89 "borderline major" band)
- `dedupByDay: boolean` → `maxPerDay: number` (configurable cap, set to 3 for the home)

The boolean → number change required:
1. Renaming the FeedQuery field
2. Replacing the TS-side `Set<string>` (was "have I seen this day?") with a `Map<string, number>` counting occurrences per day, capping at `maxPerDay`
3. Updating 5 test assertions

### Production result (sample from /zh)

```
─ 2026-04-24 ─
  imp=100  Hacker News    Google 计划向 Anthropic 投资最高 400 亿美元现金与算力
  imp=100  Hacker News    DeepSeek V4系列发布，支持百万Token上下文
  imp= 99  彭博科技         DeepSeek发布新旗舰AI模型预览版

─ 2026-04-23 ─
  imp=100  X · @OpenAI    OpenAI 发布 GPT-5.5 模型及其专业版本
  imp= 96  Hacker News    Anthropic 确认 Claude Code 质量下滑由三项改动导致
  imp= 94  Hacker News    Meta 计划裁员 10% 约 8000 人以支持 AI 投资

─ 2026-04-22 ─
  imp=100  OpenAI 博客      OpenAI 在 ChatGPT 中推出工作区代理功能
  imp= 98  Hacker News    Workspace agents 在企业工具间执行自动化工作流
  imp= 98  Hacker News    Qwen3.6-27B开源发布

─ 2026-04-21 ─
  imp=100  Hacker News    SpaceX 与 Cursor 达成收购协议，交易金额 600 亿美元
  imp=100  彭博科技         Apple宣布硬件负责人Ternus接任CEO
  imp=100  X · @OpenAI    OpenAI发布ChatGPT Images 2.0图像生成模型
```

10 days × ~3 events each, every entry at importance ≥ 80, led by authoritative sources (Hacker News, Bloomberg, OpenAI/Anthropic vendor accounts).

---

## Tuning the daily-highlights knobs

Two operator-facing knobs in `app/[locale]/page.tsx`:

```ts
...(dailyHighlights ? { minImportance: 80, maxPerDay: 3 } : {}),
```

Recommended ranges based on the production importance distribution:

| `minImportance` | What you'll see |
|---|---|
| 95+ | Crisis-only — major launches, M&A, exec transitions. ~1-2 days/week have content |
| 90 | Top-tier events. ~5-7 days/week have content. 1-2 events per qualifying day |
| 85 | Major events including secondary stories. Most days have content; tighter feel |
| **80** (current) | Notable events. Good balance — every day has 1-3 events worth reading |
| 75 | Mid-tier admitted. Risk of "Google Flow Music"-class items leaking through |
| < 70 | Don't — featured tier already includes everything ≥ 70-ish |

| `maxPerDay` | What you'll see |
|---|---|
| 1 | Strict "headline only" — one event per day, very sparse |
| 2 | Sparse digest |
| **3** (current) | Day-digest feel — headline + 1-2 supporting events |
| 5 | Dense digest — admits more depth but starts to feel chronological |
| 10+ | Effectively no cap — see the full feed for that day |

If you want even denser, raise `maxPerDay`. If you want only the absolute biggest events, raise `minImportance` instead. They compose — `minImportance: 90, maxPerDay: 5` would give "high-quality + denser" days.

---

## Files quick-reference

### Modified in commit `cf30b3e` (post-merge tuning)

```
lib/items/live.ts                         dedupByDay → maxPerDay (number); fetch headroom updated
app/[locale]/page.tsx                     minImportance 85 → 80; dedupByDay: true → maxPerDay: 3
tests/items/live-today-view.test.ts       5 assertions updated for new field names + values
```

### Created earlier in PR #28 (now on main)

```
workers/cluster/lead-pick.ts              Authority-aware lead picker
workers/cluster/merge.ts                  Stage B+ merge logic
tests/cluster/lead-pick.test.ts           13 assertions
tests/cluster/merge.test.ts               22 assertions
tests/items/live-today-view.test.ts       8 assertions (now 13 after the relax tuning)
scripts/migrations/merge-near-duplicate-clusters.ts
scripts/migrations/recompute-cluster-leads.ts
scripts/ops/diag-cluster.ts
scripts/ops/drain-canonical-titles.ts
docs/aggregation/HANDOFF-2026-04-25-cluster-merge.md
docs/aggregation/HANDOFF-2026-04-26-lead-pick.md
docs/aggregation/HANDOFF-2026-04-27-daily-highlights.md   this file
```

---

## Operator runbook

```bash
# Verify daily-highlights output locally against prod DB
cat > /tmp/verify.ts <<'EOF'
import { getFeaturedStories } from "@/lib/items/live";
import { closeDb } from "@/db/client";
const home = await getFeaturedStories({
  tier: "featured", locale: "zh", limit: 30, view: "archive",
  excludeSourceTags: ["arxiv", "paper"],
  minImportance: 80, maxPerDay: 3,
});
let prevDay = "";
for (const s of home) {
  const day = new Date(s.publishedAt).toISOString().slice(0, 10);
  if (day !== prevDay) console.log(`\n  ─ ${day} ─`);
  prevDay = day;
  console.log(`    imp=${String(s.importance).padStart(3)}  ${s.source.publisher.slice(0,16).padEnd(16)}  ${(s.title ?? "").slice(0, 55)}`);
}
await closeDb();
EOF
cp /tmp/verify.ts scripts/ops/_verify.ts && bun run scripts/ops/_verify.ts && rm scripts/ops/_verify.ts

# Tune the knobs if the feed feels off
# (edit minImportance / maxPerDay in app/[locale]/page.tsx, then commit + push)
```

---

## Carried open follow-ups (deferred, non-blocking)

From earlier handoffs in this PR, still relevant:

- **Vendor-official ↔ media recall** — re-snapshot multi-member rates after a week of post-deploy traffic. With the new prefer-clustered Stage A bias, vendor↔media singletons should now find their media cluster.
- **Stage B prompt tuning** — review `cluster_splits` audit table after the merged-cluster regime stabilizes.
- **Hand-labeled recall list** — operator template at `docs/reports/backtest-2026-04-24-full/hand-labeled-recall.md`.
- **No-content X-link clusters** — clusters whose canonical title says "未披露 / 无法核实" still appear as small clusters on the feed; future cleanup either suppresses them from the home or downgrades their tier in the scorer.
- **HNSW ef_search tuning** — left at default 40. Validate with sample known-related pairs from `cluster_splits`.
- **Drift-detection cron** — could add a daily cron that runs `merge --all` and alerts if `mergesExecuted > N`, suggesting Stage A is leaking duplicates again.

---

## Starting command for next session

```bash
cd /Users/xingfanxia/projects/portfolio/newsroom-wt-aggregation/
git fetch origin && cat docs/aggregation/HANDOFF-2026-04-27-daily-highlights.md
```

PR #28 is merged + deployed. `cf30b3e` is the latest commit on main. The cluster pipeline is fully de-cloned, properly led, and surfaces a clean daily-digest by default.
