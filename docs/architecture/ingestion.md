# AI·HOT — Data Ingestion & AI Pipeline Architecture

> Blueprint for how raw feeds become curated, scored, summarized, tagged stories — and how editor feedback rewrites the curation policy.
> **Status as of 2026-06-10**: ingestion, enrich/score/cluster, feedback, editorial agent, public API/MCP, AI HOT daily columns, DeepSeek treatment routing, and paper-source retirement have shipped. See Section 6 for milestone progress and deviations from the original blueprint.

---

## 1. Pipeline overview

```
 ┌─────────────┐     ┌──────────────┐     ┌──────────────┐     ┌───────────────┐     ┌──────────────┐
 │  SOURCES    │ →→→ │   FETCHER    │ →→→ │   NORMALIZE  │ →→→ │    ENRICH     │ →→→ │    SCORE     │
 │ (catalog)   │     │ (cron/queue) │     │ (schema)     │     │ (LLM summary, │     │ (LLM policy) │
 │ typed srcs  │     │              │     │              │     │  tag, embed)  │     │              │
 └─────────────┘     └──────────────┘     └──────────────┘     └───────────────┘     └──────────────┘
                                                                                             │
                                                                                             ▼
 ┌─────────────┐     ┌──────────────┐     ┌──────────────┐     ┌───────────────┐     ┌──────────────┐
 │  EDITORIAL  │ ←←← │   CLUSTER    │ ←←← │    STORE     │ ←←← │   DEDUPE      │ ←←← │   FILTER     │
 │  (feedback) │     │ (embeddings) │     │  (Postgres   │     │  (hash + sim) │     │ (threshold)  │
 │             │     │              │     │   + vector)  │     │               │     │              │
 └─────────────┘     └──────────────┘     └──────────────┘     └───────────────┘     └──────────────┘
       │
       ▼
 ┌─────────────────┐
 │  POLICY AGENT   │ → writes → editorial.skill.md (versioned in DB + git)
 │ (agent runtime) │
 └─────────────────┘
```

Each arrow is a durable step: a failed enrich doesn't re-fetch; a failed score doesn't re-enrich.

---

## 2. Components

### 2.1 Source catalog (`lib/sources/catalog.ts`)
A typed registry. Runtime source kind/group/cadence/source-locale tuples live in
`lib/types.ts` and feed both TypeScript contracts and Drizzle DB enums; source
group order/labels for the `信源` UI live in `lib/sources/groups.ts`. The
fetcher-supported source-kind subset also lives in `lib/types.ts` as
`FETCHABLE_SOURCE_KINDS`, so catalog kinds and worker support checks cannot
drift. Source entry shape (current as of 2026-06-12):

```ts
type Source = {
  id: string;                    // "anthropic-blog"
  name: { en: string; zh: string };
  url: string;                   // RSS/API/HTML URL — or "internal://<id>" for adapter-routed kinds
  kind: "rss" | "atom" | "api" | "rsshub" | "scrape" | "x-api" | "aihot-api";
  group: "vendor-official" | "media" | "newsletter" | "research" | "social" | "product" | "podcast" | "policy" | "market";
  locale: "en" | "zh" | "multi";
  cadence: "live" | "hourly" | "daily" | "weekly";
  priority: 1 | 2 | 3;          // 1 = must-have, 3 = noisy/opt-in
  tags: string[];                // capability / entity / topic axes
  enabled: boolean;
  notes?: string;
  curated?: boolean;             // surfaces on AX 严选 tab; default false
  neverExclude?: boolean;        // pre-vetted source — scorer cannot demote below "all"; default false
};
```

Grouping for the `信源` UI: same enum as `group` above, with labels/order from
`lib/sources/groups.ts`.

**Adapter-routed kinds** (`x-api`, `aihot-api`): `url` field is informational; the fetcher dispatches by `kind` to a dedicated adapter (`workers/fetcher/x-api.ts`, `workers/fetcher/aihot.ts`) that owns the API contract. See §2.9 for AI HOT integration.

**Paper-source retirement (2026-06-10)**: arXiv, Hugging Face Papers, Papers with Code, and similar paper-only feeds were removed from the catalog and cleaned from the database. The `research` group remains in the enum for deep-report feeds such as independent technical blogs and research-report newsletters; it no longer means "paper feed".

### 2.2 Fetcher worker (`workers/fetcher/`)
**Responsibility**: pull new items from a source, dedupe by `(source_id, external_id)`, write raw payload to `raw_items` table.

- Runs on **Vercel Cron** route handlers declared in `vercel.json`.
- Each source has `cadence` → scheduler bucket.
- Local operator triggers use the table-driven `scripts/ops/run-cron.ts`
  runner. Canonical package aliases mirror `vercel.json` cron route slugs
  (`cron:fetch-hourly`, `cron:article-body`, `cron:score-backfill`,
  `cron:newsletter-daily`, etc.); short aliases such as `cron:hourly`,
  `cron:body`, `cron:score`, and `cron:yt` remain available.
- RSS/Atom parsing via `fast-xml-parser`.
- RSSHub routes hit `https://rsshub.app/{route}` (public instance) or self-hosted fallback.
- Supported fetch kinds are `rss`, `atom`, `rsshub`, `x-api`, and
  `aihot-api`; other catalog kinds remain visible in source health as
  `pending` until an adapter is implemented.
- X/Twitter uses the `workers/fetcher/x-api.ts` X API v2 adapter with
  `source_health.last_external_id` as the incremental cursor.
- WeChat (微信公众号) uses RSSHub `/wechat/mp/msgalbum/{biz}` — requires persistent cookie.

**Output**: `raw_items` row — `{ id, source_id, external_id, url, title, raw_payload, published_at, fetched_at, normalized_at }`.

### 2.3 Normalizer
Converts `raw_items` → `items`:
- Extracts body text from structured `raw_payload` fields such as
  `content:encoded`, `content`, `description`, and `summary`.
- Strips HTML snippets to plain text with `linkedom` plus a regex fallback.
  Full article markdown is fetched later by the article-body worker, not by
  normalizer-time Readability extraction.
- `/api/cron/article-body` and `bun scripts/ops/run-cron.ts body` both call
  `workers/fetcher/content-prefetch.ts`, which runs the Jina article-body
  fetcher and YouTube transcript fetcher together before enrichment consumes
  `body_md`.
- Uses the fetcher-provided `published_at` timestamp, falling back to the
  current insert time only when the raw row lacks a timestamp.
- Canonicalizes the URL locally by stripping fragments and tracking params;
  it does not follow redirects.

### 2.4 Enricher (LLM)
Before spending LLM tokens, each worker atomically claims pending rows in Postgres (`FOR UPDATE SKIP LOCKED`) and records `enrich_claimed_at`, `enrich_attempts`, and `enrich_error`. Claims become retryable after the stale window, but rows stop after the max-attempt cap until an operator reset clears those fields. This prevents overlapping cron ticks or manual backfills from repeatedly charging the same stuck item.

The enrich claim query also waits for body prefetch to finish before spending
LLM tokens on normal web articles: non-X/Twitter rows require
`body_fetched_at IS NOT NULL`. X/Twitter status URLs are exempt because the
X adapter writes full tweet text into `items.body` and the article-body worker
intentionally skips auth-walled X pages.

Per item, parallel LLM calls run with a bounded per-call timeout (default 90s; `LLM_CALL_TIMEOUT_MS` override). The pipeline now chooses a treatment tier before calling the model:

1. **Treatment** — `workers/enrich/treatment.ts` classifies items as `high` or `fast`.
   - `high`: featured/P1 or importance >= 72, routed to DeepSeek V4 Pro.
   - `fast`: lower-value items, routed to DeepSeek V4 Flash with shorter output.
2. **Summary and commentary** — bilingual, friend-readable prose that keeps facts/numbers intact without translationese or memo jargon.
   - Prompt source: `workers/enrich/prompt.ts`, `workers/enrich/chinese.ts`, and `workers/cluster/prompt.ts`.
   - Model: Azure AI Foundry `DeepSeek-V4-Pro` for high treatment; `DeepSeek-V4-Flash` for fast treatment.
   - Cache by content hash / enrichment version.
3. **Tags** — structured output `{ capabilities: [], entities: [], topics: [] }`.
   - Capability axis: `Agent`, `RAG`, `多模态`, `推理`, `安全/对齐`, `性能优化`, ...
   - Entity axis: `Anthropic`, `OpenAI`, `Google`, `小米`, `字节`, `Nvidia`, ...
   - Topic axis: `产品更新`, `发表成果`, `融资`, `合作`, `政策`, `开源`, `事故`, ...
4. **Source-kind** — e.g., `官网动态 (RSS·排除企业/客户案例)`, `深度报告 (独立博客/研究报告)` — classified once per source, cached.
5. **Embedding** — Azure OpenAI `text-embedding-3-large`; store as pgvector column for later clustering.

All enrichments cached by `(item_id, enricher_version)` so enricher-version bumps re-run only once globally. Operator reset scripts clear the claim fields only when intentionally requeueing items.

### 2.5 Scorer (LLM, policy-driven)
Separate pass after enrich, because policy can change without re-enriching:

- **Input**: item + current `editorial.skill.md` (the policy).
- **Output**: `{ importance: int(0, 100), reasoning: string, tier: "featured" | "all" | "p1" | "excluded" }`.
  Runtime item-tier values live in `ITEM_TIERS` / `VISIBLE_ITEM_TIERS` in
  `lib/types.ts`; REST, MCP, score parsing, and commentary candidate queries
  should import those tuples instead of rewriting tier arrays.
- Model: Azure AI Foundry DeepSeek V4 Pro for high treatment and DeepSeek V4 Flash for low-value treatment, with Pro fallback when Flash output fails schema validation.
- Cached by `(item_id, policy_version)`.

### 2.6 Deduper / Clusterer
**Dedup**: hash title + canonical-url shortly after normalize. Drop exact duplicates.

**Near-dup clustering** (runs async, not on critical path):
- `/api/cron/cluster` processes enriched unclustered items.
- Stage A compares against a bidirectional ±72h window anchored to the target
  item's `published_at`.
- If cosine similarity is at least `0.75` (`halfvec` distance `<= 0.25`),
  create or join a `clusters` row and update member counts / coverage.
- Stage B arbitrates fuzzy joins, Stage C writes canonical titles, and Stage D
  writes event-level commentary for multi-member events.
- Stage B split verdicts are recorded in `cluster_splits`; Stage A and the
  singleton-recluster repair pass treat those rows as negative edges so a
  rejected item is not rejoined to the same cluster every cron tick. After
  three distinct rejected clusters, Stage A explicitly settles the item as a
  singleton before nearest-neighbor probes to cap arbitration spend on
  topical-near but event-different stories.

### 2.7 Store
Postgres (Vercel Postgres / Neon / Supabase) with schema:

```
sources          (id, name_en, name_zh, url, kind, locale, cadence, priority, enabled, ...)
raw_items        (id, source_id, external_id, payload_jsonb, fetched_at)
items            (id, source_id, title, summary_zh, summary_en, url, published_at, embedding halfvec(3072))
item_tags        (item_id, axis, tag) — composite PK
item_scores      (item_id, policy_version, importance, tier, reasoning)
clusters         (id, lead_item_id, member_item_ids int[])
feedback         (id, user_id, item_id, vote from FEEDBACK_VOTES: up | down | save, note, created_at)
policy_versions  (version, skill_md, committed_by, committed_at, parent_version, notes)
iteration_runs   (id, started_at, finished_at, parent_version, new_version, feedback_ids int[], diff_jsonb, status)
users            (id, email, role "editor" | "admin" | "reader")
```

### 2.8 Editorial Agent
The star of the system. Runs when an editor clicks `开始生成新草稿`.

**Flow**:
1. Load all unprocessed feedback since `policy_versions.current.committed_at`.
2. Spin up an agent session with tools:
   - `read_file(path)` → returns contents of `editorial.skill.md`.
   - `write_draft(content)` → stages a proposed new `editorial.skill.md`.
   - `get_feedback_sample(verdict, limit)` → returns curated feedback rows.
3. System prompt: *"You are the editorial policy maintainer. Read the current policy. Review the feedback. Propose minimal, justified edits. Produce a structured change plan: which signals added/strengthened, which exclusion rules added, which constraints added. Then emit the new full policy. Also output a `### 未做的事` section explaining what you deliberately did NOT change to avoid overfitting."*
4. Stream agent log to the UI (`策略迭代` console pane) via server-sent events.
5. On agent completion: diff old vs new, render monospace diff in the UI.
6. Editor clicks `确认应用` → commit new `policy_versions` row → **worker picks it up on next enrichment scoring pass**.
7. Toast: `策略已更新为 v{N}, Worker 下次 enrich 将使用新策略。`

**Why this architecture**: the policy is human-readable Markdown, so editors can read + hand-edit it. The agent is only one of multiple authors. Rollback = revert to an older `policy_versions` row; the worker will re-score cached items with the old policy.

---

## 3. Concrete RSSHub route catalog (zh-critical)

RSSHub converts closed Chinese platforms into RSS. Self-host via `docker run -p 1200:1200 diygod/rsshub:latest` or use public `rsshub.app`. Routes we'll rely on:

| Target | Route | Notes |
|---|---|---|
| 微信公众号 (by biz) | `/wechat/mp/msgalbum/:bizid` | Needs cookie; rotate weekly |
| 微信公众号 (by name) | `/wechat/officialaccount/:name` | Via 搜狗搜索 |
| 36氪 category | `/36kr/news/:category` | AI channel `=35` |
| 虎嗅 column | `/huxiu/channel/:id` | AI column id varies |
| 少数派 matrix | `/sspai/matrix` | |
| 机器之心 | `/jiqizhixin` | |
| 量子位 | `/qbitai` | Hot list also available |
| 知乎热榜 | `/zhihu/hotlist` | |
| 知乎用户 | `/zhihu/people/activities/:id` | |
| 即刻话题 | `/jike/topic/:id` | Per-topic feed |
| 微博用户 | `/weibo/user/:uid` | Works without auth for public |
| B站用户动态 | `/bilibili/user/dynamic/:uid` | |
| B站分区 | `/bilibili/partion/:tid` | |
| X/Twitter | `/twitter/user/:id` | **Deprecated publicly**; self-host + cookie |
| Telegram channel | `/telegram/channel/:username` | |
| Substack | `/substack/substackName` | |
| GitHub trending | `/github/trending/:since/:language` | `daily/python` etc |

RSSHub is rate-limited; we cache aggressively (TTL 1h for most, 4h for low-cadence).

---

## 4. Low-follower viral detection (`低粉爆文`)

**Deferred blueprint**: this route/feed is not shipped. The earlier
`/{locale}/low-follower` page was removed, and the feature stays blocked on
affordable source APIs for follower/impression data.

A distinct feed that surfaces posts with **high engagement relative to author reach**. Signal definition:

```
virality_score = engagement_rate * log(engagement_absolute) / log(max(follower_count, 100))

where engagement_rate = (likes + comments + reposts) / impressions    # if API provides
                     or (likes + comments + reposts) / follower_count  # fallback
```

Sources:
- **即刻**: per-post like count + author follower count via user API.
- **Substack**: public post like count + subscriber count (paid subs not visible).
- **小红书**: heart count + author follower count via mobile API (requires cookie + anti-bot).
- **X**: impressions + author followers via X API v2.
- **Bilibili**: view count + uploader fans via `https://api.bilibili.com/x/space/wbi/acc/info`.

Threshold tuning is per-platform. Initial: surface if `virality_score > 1.5` AND `follower_count < 50k`. Editor tuning lives in `editorial.skill.md` under a `### low_follower_viral` section.

---

## 5. X monitoring (`X监控`)

A curated set of enabled X handles stored as normal `sources` rows.

- Source rows use `kind='x-api'`; there is no separate watchlist table.
- Fetched by `workers/fetcher/x-api.ts` via X API v2 `users/{id}/tweets`,
  with replies/retweets excluded and `source_health.last_external_id` used
  as `since_id`.
- Stored in the same `raw_items`/`items` pipeline as RSS/API sources.
- UI: `/{locale}/x-monitor` lists enabled X handles and their item feed.

---

## 6. Implementation milestones

| Milestone | Scope | Status |
|---|---|---|
| **M0 — Shell** | Next.js 16 + next-intl v4 + Tailwind v4 + UI from screenshots + mock fixtures | ✅ shipped |
| **M1 — Read-only ingestion** | Supabase Postgres + drizzle, typed source catalog seeded, RSS/Atom/RSSHub fetcher with SSRF guard, normalizer with canonical URL + sha256 dedup, cron routes + `信源` live | ✅ shipped |
| **M2 — Enrich + Score + Cluster** | Vercel AI SDK v6 + DeepSeek V4 Pro/Flash for prose/scoring, Azure OpenAI `text-embedding-3-large` native 3072-dim via `halfvec` + HNSW cosine, cluster dedup at 0.75 similarity / 72h, `热点资讯` live feed with fallback ladder. Ultra-review: 3 CRITICAL + 7 HIGH all fixed. | ✅ shipped |
| **M3 — Feedback + Auth** | `feedback` table + admin gate + real metrics on `策略迭代` page + `POST /api/feedback` | ✅ shipped |
| **M4 — Editorial agent** | Agent session reads feedback, diffs `editorial.skill.md`, streams to console, versioned rollout | ✅ shipped |
| **X monitor + cluster UI** | X API v2 handle sources plus cross-source event chips/drawer | ✅ shipped |
| **M5 — Low-follower viral** | Viral-score detector for low-follower posts once source APIs make follower/impression data affordable | planned |

### Deviations from original blueprint (what actually shipped vs. what Section 2 specified)

- **Clustering path (§2.6)**: implemented as its own cron (`/api/cron/cluster`) not baked into enrich. The current Stage A threshold is 0.75 similarity with a 72h bidirectional published-at window. Widened neighbor search (§2.6 said "lead_item_id only"; we search all enriched) so same-batch siblings merge without a two-pass fix. Atomic row claim via `WHERE clustered_at IS NULL RETURNING` prevents double-counting. Stage A also excludes `cluster_splits` matches and settles an item as a singleton after three distinct rejected clusters, so Stage B's rejected joins do not become an every-tick arbitration loop.
- **Embeddings (§2.4)**: `voyage-3 / text-embedding-3-large` — we picked **text-embedding-3-large native 3072 dims** stored as `halfvec(3072)` (not truncated to 1536 via Matryoshka). Same storage as `vector(1536)`, full quality, fits pgvector HNSW's 4000-dim cap.
- **Scoring model (§2.5)**: "Sonnet 4.6" placeholder → shipped first as Azure GPT, then moved on 2026-06-10 to **Azure AI Foundry DeepSeek V4 Pro/Flash**. High-value items use Pro; lower-value items use Flash to avoid spending heavy tokens on throwaway content.
- **LLM SDK choice**: original plan assumed direct vendor SDKs — migrated to **Vercel AI SDK v6** + `@ai-sdk/{anthropic,google,azure,openai}` for unified `generateText` / `generateObject` / `embed` across providers.
- **Prompt injection defense** (not in original §2): XML-fence untrusted content + system-prompt framing + control-sequence neutralization (added per security review).
- **Cron timing**: `vercel.json` owns the schedule. Current production routes are fetch-hourly, fetch-daily, fetch-weekly, normalize, article-body, enrich, commentary, score-backfill, cluster, newsletter-daily, and newsletter-monthly. Article-body, enrich, commentary, score-backfill, and cluster are split so one slow/spendy stage cannot starve the others. Local operator cron commands mirror every production cron slug and reuse the same worker helpers instead of reassembling production steps by hand; legacy short aliases stay as wrappers only.
- **Enrich claim/backoff guardrail (2026-06-11)**: the enrich cron now claims work in Postgres before LLM calls and stores retry state on `items`. This closes the gap where overlapping cron/manual backfill runs could all select the same `enriched_at IS NULL` rows and waste spend even if the final write was idempotent.
- **AI HOT integration (2026-05-08, voice refreshed 2026-06-10)**: added pre-curated source `aihot-selected` (kind `aihot-api`) ingesting hourly from https://aihot.virxact.com; merge their structured `/api/public/daily` report into our daily column generator as a must-cover baseline (`newsletters.aihot_daily_payload` + `aihot_daily_date`). Voice prompts now target a friend-sharing style: plain, useful, accurate, and low on AI/memo flavor. Full design: `docs/aihot-integration/PLAN.md`. New env vars: `AIHOT_API_BASE_URL` + `AIHOT_API_USER_AGENT` (both with safe defaults). Operator scripts: `scripts/ops/backfill-style.ts` (cost-bounded re-enrich) + `scripts/ops/import-aihot-daily-history.ts` (180-day daily history import).
- **Tier-gated commentary (2026-05-08, PR #34)**: Stage-4 commentary now branches by tier instead of running the full schema for every non-excluded item. `editor_note_*` (一句话点评) runs for every non-excluded item / event; `editor_analysis_*` **only** runs for tier `featured` / `p1`. Tier `all` items take the lighter `commentaryNoteSchema` LLM call (`COMMENTARY_NOTE_ONLY_SYSTEM`, ~85% smaller output). Cluster commentary path also extended to cover `event_tier='all'`. Worker dispatch in `workers/enrich/commentary.ts` + `workers/cluster/commentary.ts`; backfill mirror in `scripts/ops/backfill-style.ts`.
- **Editorial taxonomy rebrand + home default flip (2026-05-08, PR #35)**: `editor_analysis_*` rebranded `深度解读` → `锐评` with 200 字 hard cap (was 300-500 字 / 800 ceiling); `summary_*` tightened from 120-220 字 multi-sentence to 50-90 字 一句话总结; UI label `编辑点评` → `一句话点评`. Three layered editorial outputs now have crisp role separation — see policy spec `modules/feed/runtime/policy/skills/editorial.skill.md` § "Editorial taxonomy". Concurrently the homepage default flipped from multi-day "3 stories per day" digest to today's hot events (importance-sorted hot-window); daily digest reachable via `?view=daily` toggle in HomeFilters. `maxTokens` dropped 6144 → 3072 in commentary workers (200-字 fits comfortably). DB columns unchanged — only prompts, UI labels, and worker token budgets shifted. Editorial policy bumped to v2 in `policy_versions` table to make the new commentary_at threshold actionable for backfills.
- **Agent access — public anonymous mirror (2026-05-13, PR #36)**: opened a third integration track alongside bearer-gated `/api/v1/*` + `/api/mcp`. Eight new read-only endpoints under `/api/public/*` (feed / items / search / sources / events / daily / daily-by-date / dailies) — anonymous, IP-rate-limited (`lib/rate-limit/public.ts`), weak ETag + If-None-Match → 304 (`lib/api/public-helpers.ts`), CORS open, LLM-internal fields stripped (raw reasoning, per-axis HKR `reasonsZh/En`). Discovery: hosted `/skill.md` (SKILL.md standard, installable into any SKILL-aware agent), `/openapi.yaml` (OpenAPI 3.1), `/robots.txt` (allow public surfaces, disallow admin/v1/cron), `/sitemap.xml` (Next.js metadata files `app/robots.ts` + `app/sitemap.ts`). New bilingual page `/{locale}/agents` with 3 tabs (Skill / RSS / REST API) modeled on AI HOT's `/agent-access`. Full surface and contributor guide in [`docs/agent-access/README.md`](../agent-access/README.md). No schema changes. No env-vars added.
- **DeepSeek treatment routing + paper-source retirement (2026-06-10)**: added `azure-deepseek` provider support for Azure AI Foundry Responses-style endpoints, schema-aware JSON parsing for DeepSeek structured output, Pro/Flash treatment tiers, and friend-readable zh/en prompts. Backfilled Chinese summaries, score reasoning, commentary, clusters, and 51 daily columns. Removed paper-only sources from catalog, `/papers`, RSS/MCP/API discovery, and historical DB rows; `scripts/ops/cleanup-paper-sources.ts` now verifies the retired paper-source set is empty.

---

## 7. Deferred questions

- **Costs**: enrichment at 2k items/day × $0.001 per LLM call ≈ $60/mo, manageable.
- **Translation strategy**: machine-translate all items to the other locale on-demand? Too expensive eagerly; do per-request with cache.
- **Author profiles**: do we model authors separately (dwarkesh, karpathy) or just attribute to source? Defer.
- **Subscribers / alerts**: email digest, web push on P1 items — not in v1.
