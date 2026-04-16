# AI·HOT — Data Ingestion & AI Pipeline Architecture

> Blueprint for how raw feeds become curated, scored, summarized, tagged stories — and how editor feedback rewrites the curation policy.
> **Status**: M0 + M1 + M2 shipped. M3 (feedback) next. See Section 6 for milestone progress and deviations from this blueprint.

---

## 1. Pipeline overview

```
 ┌─────────────┐     ┌──────────────┐     ┌──────────────┐     ┌───────────────┐     ┌──────────────┐
 │  SOURCES    │ →→→ │   FETCHER    │ →→→ │   NORMALIZE  │ →→→ │    ENRICH     │ →→→ │    SCORE     │
 │ (catalog)   │     │ (cron/queue) │     │ (schema)     │     │ (LLM summary, │     │ (LLM policy) │
 │  ~50 feeds  │     │              │     │              │     │  tag, embed)  │     │              │
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
 │ (Claude SDK)    │
 └─────────────────┘
```

Each arrow is a durable step: a failed enrich doesn't re-fetch; a failed score doesn't re-enrich.

---

## 2. Components

### 2.1 Source catalog (`lib/sources/catalog.ts`)
A typed registry. Source entry shape:

```ts
type Source = {
  id: string;                    // "anthropic-blog"
  name: { en: string; zh: string };
  url: string;                   // RSS/API/HTML URL
  kind: "rss" | "atom" | "api" | "rsshub" | "scrape";
  locale: "en" | "zh" | "multi";
  cadence: "live" | "hourly" | "daily" | "weekly";
  priority: 1 | 2 | 3;          // 1 = must-have, 3 = noisy/opt-in
  tags: string[];                // capability / entity / topic axes
  enabled: boolean;
  extractor?: string;            // for scrape kind: css selector spec id
  headers?: Record<string, string>;
  authMethod?: "none" | "cookie" | "api-key";
  notes?: string;
};
```

Grouping for the `信源` UI: `vendor-official | media | newsletter | research | social | product | podcast | policy | market`.

### 2.2 Fetcher worker (`workers/fetcher/`)
**Responsibility**: pull new items from a source, dedupe by `(source_id, external_id)`, write raw payload to `raw_items` table.

- Runs on **Vercel Cron** (free-tier) OR a dedicated **Upstash QStash** queue for granular cadence.
- Each source has `cadence` → scheduler bucket.
- RSS/Atom parsing via `fast-xml-parser`.
- Scrape sources use `@vercel/edge-rate-limit` + `linkedom` for DOM traversal.
- RSSHub routes hit `https://rsshub.app/{route}` (public instance) or self-hosted fallback.
- X/Twitter uses **Apify `x-crawler` actor** OR X API v2 if budget allows.
- WeChat (微信公众号) uses RSSHub `/wechat/mp/msgalbum/{biz}` — requires persistent cookie.

**Output**: `raw_items` row — `{ id, source_id, external_id, url, title, raw_html, raw_text, published_at, fetched_at }`.

### 2.3 Normalizer
Converts `raw_items` → `items`:
- HTML → clean text (Readability.js via `@mozilla/readability`).
- Author extraction.
- Publication-timestamp parsing (per-source template).
- Canonical URL resolution (follows redirects, strips UTM).

### 2.4 Enricher (LLM)
Per item, parallel LLM calls with 30s budget:

1. **Summary** — 2–3 sentence Chinese abstract.
   - Prompt: *"用中文生成 2–3 句的新闻摘要，突出关键事实、数字、实体；避免营销语言。"*
   - Model: `claude-haiku-4-5` (fast, cheap). Cache by content hash.
2. **Tags** — structured output `{ capabilities: [], entities: [], topics: [] }`.
   - Capability axis: `Agent`, `RAG`, `多模态`, `推理`, `安全/对齐`, `性能优化`, ...
   - Entity axis: `Anthropic`, `OpenAI`, `Google`, `小米`, `字节`, `Nvidia`, ...
   - Topic axis: `产品更新`, `发表成果`, `融资`, `合作`, `政策`, `开源`, `事故`, ...
3. **Source-kind** — e.g., `官网动态 (RSS·排除企业/客户案例)`, `Research (发表成果·网页)` — classified once per source, cached.
4. **Embedding** — `voyage-3` or `text-embedding-3-large`; store as pgvector column for later clustering.

All enrichments cached by `(item_id, enricher_version)` so enricher-version bumps re-run only once globally.

### 2.5 Scorer (LLM, policy-driven)
Separate pass after enrich, because policy can change without re-enriching:

- **Input**: item + current `editorial.skill.md` (the policy).
- **Output**: `{ importance: int(0, 100), reasoning: string, tier: "featured" | "all" | "P1" | "excluded" }`.
- Model: `claude-sonnet-4-6` (quality > speed, ~1 call per item).
- Cached by `(item_id, policy_version)`.

### 2.6 Deduper / Clusterer
**Dedup**: hash title + canonical-url shortly after normalize. Drop exact duplicates.

**Near-dup clustering** (runs async, not on critical path):
- For each new enriched item, compute cosine similarity vs last 48h window.
- If `sim > 0.88`, create or join a `cluster` row: `cluster_id, lead_item_id, member_item_ids[], sources[]`.
- Timeline shows the lead item with a `另有 N 个源也报道了此事件` badge — click expands member list.

### 2.7 Store
Postgres (Vercel Postgres / Neon / Supabase) with schema:

```
sources          (id, name_en, name_zh, url, kind, locale, cadence, priority, enabled, ...)
raw_items        (id, source_id, external_id, payload_jsonb, fetched_at)
items            (id, source_id, title, summary_zh, summary_en, url, published_at, embedding vector(1024))
item_tags        (item_id, axis, tag) — composite PK
item_scores      (item_id, policy_version, importance, tier, reasoning)
clusters         (id, lead_item_id, member_item_ids int[])
feedback         (id, user_id, item_id, verdict "up" | "down" | "save", note, created_at)
policy_versions  (version, skill_md, committed_by, committed_at, parent_version, notes)
iteration_runs   (id, started_at, finished_at, parent_version, new_version, feedback_ids int[], diff_jsonb, status)
users            (id, email, role "editor" | "admin" | "reader")
```

### 2.8 Editorial Agent (Claude Agent SDK)
The star of the system. Runs when an editor clicks `开始生成新草稿`.

**Flow**:
1. Load all unprocessed feedback since `policy_versions.current.committed_at`.
2. Spin up a Claude Agent session with tools:
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

A curated watchlist of researchers + labs whose tweets we always want to see (not score-gated).

- Stored as `x_watchlist` table: `(handle, reason, active)`.
- Fetched via Apify actor `x-scraper` every 15 min or X API v2 `users/{id}/tweets`.
- Displayed chronologically, grouped by author.
- Feedback on a tweet can promote it to the main `热点资讯` feed.

Seed watchlist (v0): `@sama`, `@AndrewYNg`, `@ylecun`, `@drjimfan`, `@karpathy`, `@_akhaliq`, `@jxmnop`, `@suchenzang`, `@erichartford`, `@tri_dao`, Chinese researchers list TBD.

---

## 6. Implementation milestones

| Milestone | Scope | Status |
|---|---|---|
| **M0 — Shell** | Next.js 16 + next-intl v4 + Tailwind v4 + UI from screenshots + mock fixtures | ✅ shipped |
| **M1 — Read-only ingestion** | Supabase Postgres + drizzle, 41 sources seeded, RSS/Atom/RSSHub fetcher with SSRF guard, normalizer with canonical URL + sha256 dedup, 4 cron routes + `信源` live | ✅ shipped |
| **M2 — Enrich + Score + Cluster** | Vercel AI SDK v6 + Azure OpenAI (standard for enrich at low reasoning + score at high reasoning), `text-embedding-3-large` native 3072-dim via `halfvec` + HNSW cosine, cluster dedup at 0.88/48h, `热点资讯` live feed with fallback ladder. Ultra-review: 3 CRITICAL + 7 HIGH all fixed. | ✅ shipped |
| **M3 — Feedback + Auth** | `feedback` table + Supabase Auth magic-link + real metrics on `策略迭代` page + `POST /api/feedback` | ⏳ next |
| **M4 — Editorial agent** | Agent SDK session reads feedback, diffs `editorial.skill.md`, streams to console, versioned rollout. Uses `azure-openai-pro` @ `xhigh` reasoning. | planned |
| **M5 — X monitor + Low-follower + cluster UI** | X watchlist via Apify/X API v2, viral-score detector, "also reported by N sources" chips | planned |

### Deviations from original blueprint (what actually shipped vs. what Section 2 specified)

- **Clustering path (§2.6)**: implemented as its own cron (`/api/cron/cluster`) not baked into enrich. Widened neighbor search (§2.6 said "lead_item_id only"; we search all enriched) so same-batch siblings merge without a two-pass fix. Atomic row claim via `WHERE clustered_at IS NULL RETURNING` prevents double-counting.
- **Embeddings (§2.4)**: `voyage-3 / text-embedding-3-large` — we picked **text-embedding-3-large native 3072 dims** stored as `halfvec(3072)` (not truncated to 1536 via Matryoshka). Same storage as `vector(1536)`, full quality, fits pgvector HNSW's 4000-dim cap.
- **Scoring model (§2.5)**: "Sonnet 4.6" placeholder → shipped as **Azure `gpt-5.4-standard` at `reasoning_effort: high`**. Pro is faster/cheaper at comparable quality for rubric tasks; pro reserved for the lower-volume M4 agent.
- **LLM SDK choice**: original plan assumed direct vendor SDKs — migrated to **Vercel AI SDK v6** + `@ai-sdk/{anthropic,google,azure,openai}` for unified `generateText` / `generateObject` / `embed` across providers.
- **Prompt injection defense** (not in original §2): XML-fence untrusted content + system-prompt framing + control-sequence neutralization (added per security review).
- **Cron timing**: enrich every 15 min, cluster every 30 min, catch-up normalize every 6 h.

---

## 7. Deferred questions

- **Costs**: enrichment at 2k items/day × $0.001 per LLM call ≈ $60/mo, manageable.
- **Translation strategy**: machine-translate all items to the other locale on-demand? Too expensive eagerly; do per-request with cache.
- **Author profiles**: do we model authors separately (dwarkesh, karpathy) or just attribute to source? Defer.
- **Subscribers / alerts**: email digest, web push on P1 items — not in v1.
