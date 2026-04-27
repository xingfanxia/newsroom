# Newsroom — handoff after authority-aware lead pick + de-biased title prompt (2026-04-26)

> **Read order**:
> 1. This file (lead-pick + Stage C prompt fix)
> 2. `docs/aggregation/HANDOFF-2026-04-25-cluster-merge.md` (cluster-merge fix — same PR)
> 3. `docs/aggregation/HANDOFF-2026-04-25.md` (gpt-5.5 + Stage A recall fix)

---

## Status: 4th commit on PR #28, drained on production

Branch: `fix/cluster-merge-prefer-clustered`
Commit: `7bfb03e` — fix(cluster): authority-aware lead picking + de-bias canonical title prompt

PR #28 still open. After it merges:
- Stage A (prefer-clustered bias)
- Stage B+ merge stage in cron
- Stage C (authority-aware lead recompute + de-biased prompt)

…all ship together.

---

## What shipped this commit

### The bug

User flagged two prominent multi-source events with wrong feed cards:

1. **DeepSeek V4 (9 sources)** — lead source displayed as `r/LocalLLaMA`; canonical title was "DeepSeek V4 发布传闻在 Reddit 流传" (release rumors spreading on Reddit) — even though Hacker News and Product Hunt members confirmed the release.
2. **GPT-5.5 (9 sources)** — lead source `X · @dotey` (third-party Chinese tech commentator) even though the cluster contains both `X · @OpenAI` (vendor account) AND `OpenAI Blog` (official vendor blog).

### Root cause (two layers)

**Layer 1 — wrong lead.** Stage A sets `cluster.lead_item_id` to whichever item happened to start the cluster (first-to-arrive). Fast-moving sources (X, Reddit) publish before vendor blogs and major media, so the lead is almost always a social/community post — and the feed card shows the wrong source label.

**Layer 2 — bad title.** Stage C's old prompt fed the LLM a flat `[source] zh: ... en: ...` list with no authority signal. With most members being r/LocalLLaMA, the LLM picked up the Reddit framing ("rumors", "spreading on Reddit") and propagated it into the canonical title. No mechanism to weight vendor-official members higher than the social majority.

### Fix

1. **`workers/cluster/lead-pick.ts`** (new) — authority-aware picker using the existing `source.group` enum:
   ```
   vendor-official (100) > media/research (80)
                         > newsletter/policy/market (50)
                         > podcast/product (40)
                         > social (20)
   ```
   Plus operator-set `source.priority` (each step from the default of 2 = ±20). Item importance acts as a sub-tiebreaker (`importance / 10`). Final tiebreak: earlier `publishedAt` (the original beats corroboration).

2. **`workers/cluster/canonical-title.ts`** — Stage C now loads `source.group` + `source.priority` for each member, calls `pickBestLead()`, and writes back `cluster.lead_item_id` BEFORE the LLM call (so the source label on the feed card is fixed even if the title regen errors out).

3. **`workers/cluster/prompt.ts`** — new Stage C prompt rules:
   - **Bans platform names in titles**: "在 Reddit 流传", "on Reddit", "HN thread", etc. The title is the EVENT, not the coverage.
   - **Confirmation beats speculation**: if some members say "X released" and others say "X coming?", the event IS released. Hedging members are *reactions*. Only emit "传闻"/"rumored" when NO member confirms.
   - **PRIMARY vs CORROBORATING ranking**: user prompt now renders the highest-authority member first as PRIMARY, the rest as CORROBORATING. Gives the LLM a clear authority hierarchy instead of being pulled toward the social majority's framing.

4. **`workers/cluster/canonical-title.ts` SQL fix** — caught a NULL trap while testing: the candidate filter `(canonical_title_zh IS NULL OR updated_at > titled_at)` silently misses any cluster whose `titled_at` was nullified, because `updated_at > NULL` evaluates to NULL (falsy). Added `OR titled_at IS NULL` clause + regression test. **This bug had been live; my backfill exposed it.**

5. **`scripts/migrations/recompute-cluster-leads.ts`** — backfill that recomputed leads for all 469 multi-member clusters in production. **241 of 469 (51%) had a wrong lead.** Backfill nullified `titled_at` on those 241 so Stage C re-titles with the new prompt.

6. **`scripts/ops/drain-canonical-titles.ts`** — local Stage C runner (uses new code against prod DB). Drained 267 titles in 7.5 min, 0 errors. Otherwise would have taken ~16 cron ticks (8 hours) AND used the OLD prompt because production hasn't deployed yet.

---

## Verification

**The two user-reported clusters:**

| Cluster | Before | After |
|---|---|---|
| **DeepSeek V4** (19356) | lead: `r/LocalLLaMA` · title: *"DeepSeek V4 发布传闻在 Reddit 流传"* | lead: **Hacker News Frontpage** · title: **"DeepSeek 发布 V4 模型"** |
| **GPT-5.5** (13828) | lead: `X · @dotey` · title: *"OpenAI发布GPT-5.5模型向付费用户开放"* | lead: **X · @OpenAI** · title: **"OpenAI 发布 GPT-5.5 模型及其专业版本"** |

DeepSeek V4 title now says **"发布"** (released) instead of **"传闻"** (rumored) — confirmation-beats-speculation rule firing. No "Reddit" leak.

**Random sample of recently re-titled clusters** (all clean event-focused titles):
- cluster 14107 [media] TechCrunch AI: "Google 推出 macOS 原生 Gemini 应用支持屏幕共享"
- cluster 20064 [media] Hacker News Frontpage: "DeepSeek V4系列发布，支持百万Token上下文"
- cluster 12475 [vendor-official] OpenAI Blog: "OpenAI 发布 GPT-5 并向全部用户开放"
- cluster 18822 [media] Hacker News Frontpage: "Anthropic 将 Claude Code 从 Pro 订阅中移除"
- cluster 17358 [media] QbitAI WeChat: "年度 AI 榜单申报启动，截止四月二十七日"

**Final state:**
- 470/470 multi-member clusters titled, 0 pending
- 267 titles regenerated by the local drain (the rest already had correct leads + titles)
- 0 errors

---

## Tests

138/138 passing across `workers/cluster/` + `tests/cluster/`:
- 13 new assertions for `lead-pick` logic (group ladder, priority offset, importance tiebreak, the two reported cases)
- 8 new assertions for the prompt anti-bias rules
- 3 new assertions for the SQL NULL-trap regression

---

## Open follow-ups (still non-blocking)

Carried from prior handoffs, still relevant:

- **No-content X-link clusters** — clusters like 12210, 21622 have canonical titles like "无法确认的X帖子链接" / "无法确定事件内容" because the source is just a t.co link with no body. These already exist as separate cluster rows; the merge stage filters them out from MERGE candidates but they still appear on the feed as singletons or 2-member clusters. Future cleanup: either (a) suppress no-content clusters from the home feed entirely, or (b) auto-flag them via tier downgrade in the scorer.
- **Vendor-official ↔ media recall** — still open. With the prefer-clustered Stage A bias deployed, vendor↔media singletons should now find their media cluster. Re-snapshot multi-member rates after a week of post-deploy traffic.
- **Stage B prompt tuning** — review `cluster_splits` audit table after the new merged-cluster regime stabilizes.
- **Hand-labeled recall list** — operator template at `docs/reports/backtest-2026-04-24-full/hand-labeled-recall.md`.

---

## Files quick-reference

### Created

```
workers/cluster/lead-pick.ts                            Authority ladder + pickBestLead()
tests/cluster/lead-pick.test.ts                         13 assertions
scripts/migrations/recompute-cluster-leads.ts           One-shot lead backfill (idempotent)
scripts/ops/drain-canonical-titles.ts                   Local Stage C drainer
docs/aggregation/HANDOFF-2026-04-26-lead-pick.md        This file
```

### Modified

```
workers/cluster/canonical-title.ts                      Lead recompute before LLM call + SQL NULL fix
workers/cluster/prompt.ts                               Anti-bias rules + PRIMARY/CORROBORATING ranking
workers/cluster/canonical-title.test.ts                 New assertions for prompt + SQL filter
```

---

## Operator runbook

```bash
# 0. Worktree
cd /Users/xingfanxia/projects/portfolio/newsroom-wt-aggregation/

# 1. After ANY change to authority weights or source.group enum:
#    re-validate via the recompute-leads script first
bun run scripts/migrations/recompute-cluster-leads.ts            # dry-run

# 2. Apply lead recompute (idempotent — safe to re-run)
bun run scripts/migrations/recompute-cluster-leads.ts --apply

# 3. Drain Stage C locally with the new code (faster than waiting for cron)
bun run scripts/ops/drain-canonical-titles.ts

# 4. Spot-check a cluster
bun run scripts/ops/diag-cluster.ts 19356 13828

# 5. Add --retitle-bad to also nullify titled_at on clusters with bad-pattern
#    titles even when the lead didn't change (catches old-prompt artefacts)
bun run scripts/migrations/recompute-cluster-leads.ts --retitle-bad --apply
```

---

## Starting command for next session

```bash
cd /Users/xingfanxia/projects/portfolio/newsroom-wt-aggregation/
git fetch origin && cat docs/aggregation/HANDOFF-2026-04-26-lead-pick.md
```

PR #28 should be merged before any new cluster-pipeline work. After merge:
- production cron uses the new authority-aware lead pick + de-biased prompt
- Stage B+ merge stage runs at 6h recency window every cron tick
- the Stage A prefer-clustered bias prevents new same-source-twin clones
