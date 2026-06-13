# AX's AI RADAR

> **A bilingual AI intelligence radar with a self-iterating editorial agent.** Monitored sources in, curated signal out.
> Terminal-forward command-center aesthetic with HKR score rings; JetBrains Mono + Noto Sans/Serif SC; zh/en locale-first.

🌐 **Live**: [newsroom-orpin.vercel.app](https://newsroom-orpin.vercel.app) → redirects to `/zh`
📦 **Repo**: [github.com/xingfanxia/newsroom](https://github.com/xingfanxia/newsroom)

[中文](#中文) · [English](#english)

---

## English

### What it is

AX's AI RADAR is a dashboard for editors and analysts who cover the AI industry. It does four things:

1. **Ingests** the monitored source catalog (RSS, Atom, RSSHub, APIs, scraping) — vendor blogs, media, newsletters, deep-report feeds, social signal, podcasts, policy, market, and product sources.
2. **Enriches** each story via LLM — Chinese / English summary, friend-readable commentary, 0–100 importance score, multi-axis taxonomy (capability / entity / topic), and cross-source clustering.
3. **Curates** with a human-readable `editorial.skill.md` policy file. Editors click 👍 / 👎 / ⭐ and add notes.
4. **Iterates itself** — a Claude Agent reads accumulated feedback, diffs `editorial.skill.md`, shows the change for approval, and ships it as v-next. Workers pick up the new policy on the next enrichment pass.

### Surfaces

| Route | Purpose |
|---|---|
| `/{locale}` | 热点资讯 / Hot News — curated timeline with HKR rings + tier/source filters + auto-scroll ticker |
| `/{locale}/all` | 全部 / All Posts — everything non-excluded, same source filter |
| `/{locale}/x-monitor` | X 监控 — 7 tracked handles with per-handle sidebar + firehose feed |
| `/{locale}/saved` | 收藏 — **user-named collections** with inbox + tags + move/export MD |
| `/{locale}/sources` | 信源 — grouped tables or card grid (`?view=cards`) |
| `/{locale}/podcasts` | 播客 · 视频 — podcast/video feed with per-channel filter pills |
| `/{locale}/agents` | Agent 接入 — 3-tab integration page (Skill / RSS / REST API). See [`docs/agent-access/`](./docs/agent-access/) |
| `/{locale}/admin/usage` | 用量 — LLM spend cards (today / 7d / 30d / all-time), task/model breakdowns, and recent-call model labels |
| `/{locale}/admin/system` | 系统 — Source health, queues, cron status, and recent errors |
| `/{locale}/admin/policy` | 精选策略 — **editable** markdown with live preview; commits new version |
| `/{locale}/admin/iterations` | 策略迭代 — metric cards + agent console + diff preview + **version timeline** |
| `/{locale}/admin/users` | 用户 (coming soon) |

### Tech stack

- **Next.js 16** (App Router, Turbopack, Fluid Compute), **React 19**, **TypeScript**
- **Tailwind v4** (CSS-first design tokens in `globals.css`)
- **next-intl** v4 for `zh` / `en` routing and messages
- **Radix Slot** for polymorphic buttons + `lucide-react` icons
- **Supabase Postgres** + **drizzle-orm** + **pgvector 0.8** (`halfvec(3072)` + HNSW)
- **Vercel AI SDK v6** unifies LLM + embedding access across providers:
  - Azure AI Foundry DeepSeek V4 Pro for high-value bilingual enrich, score, commentary, cluster summaries, and daily columns.
  - Azure AI Foundry DeepSeek V4 Flash for low-value item treatment and cheap arbitration work.
  - Azure OpenAI `text-embedding-3-large` remains the embedding provider; `gpt-5.5-standard` is kept as a compatibility/probe deployment, not the default prose model.
  - Anthropic Claude Opus 4.7 + Google Gemini 3.1 Pro Preview are wired as optional fallbacks.
- **Vercel Cron** triggers 11 route handlers: fetch hourly/daily/weekly, normalize, article-body, enrich, commentary, score-backfill, cluster, and newsletter daily/monthly.
- **bun** for install / build / dev / tests

### Design system

Terminal-forward command-center aesthetic — green/orange/blue accents on a near-black canvas, JetBrains Mono for Latin + Noto Sans/Serif SC for CJK, HKR circular score rings, `.shell` grid with left nav + main + optional right rail, auto-scrolling ticker, radar-sweep widget. Tokens in [`app/globals.css`](./app/globals.css); full layout rules in [`app/terminal.css`](./app/terminal.css). Live-configurable via the site-config panel (⌥, to open) with 4 themes × 6 accents × 4 radii × 3 chrome styles × 4 score visuals.

### Data ingestion & AI pipeline

Blueprint in [`docs/architecture/ingestion.md`](./docs/architecture/ingestion.md). Source catalog in [`lib/sources/catalog.ts`](./lib/sources/catalog.ts). Editorial policy lives at [`modules/feed/runtime/policy/skills/editorial.skill.md`](./modules/feed/runtime/policy/skills/editorial.skill.md). Enrichment workers claim rows in Postgres before spending LLM tokens, wait for body prefetch on normal web articles, and cap retry attempts, so overlapping cron/backfill runs do not repeatedly process the same stuck item or title-only page. Local operator cron triggers mirror the `vercel.json` route slugs, for example `bun run cron:fetch-hourly`, `bun run cron:article-body`, `bun run cron:score-backfill`, and `bun run cron:newsletter-daily`; short aliases such as `cron:hourly`, `cron:body`, `cron:score`, and `cron:yt` remain available.

### Local setup

```bash
# 1. copy env template and fill in keys
cp .env.example .env.local
# edit .env.local to add AZURE_DEEPSEEK_*, AZURE_OPENAI_* embedding/chat keys,
# optional ANTHROPIC_API_KEY and GEMINI_API_KEY

# 2. install + dev
bun install
bun run dev

# open http://localhost:3000 → redirects to /zh
```

### Environment variables

See [`.env.example`](./.env.example) for the complete template. On Vercel, most values are auto-provisioned by the Supabase Marketplace integration + the initial deploy — run `vercel env pull .env.local --yes` to sync locally. Key groups:

- **Supabase** (`POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`, `SUPABASE_*`) — auto-wired by Marketplace.
- **Azure OpenAI embeddings** (`AZURE_OPENAI_API_KEY` / `_ENDPOINT` / `_EMBEDDING_DEPLOYMENT`) — handles `text-embedding-3-large` only.
- **Azure OpenAI chat compatibility** (`AZURE_OPENAI_CHAT_*`) — points at the Responses API deployment `gpt-5.5-standard`; retained for compatibility/probes.
- **Azure DeepSeek** (`AZURE_DEEPSEEK_*`) — primary prose/scoring provider, with `DeepSeek-V4-Pro` and `DeepSeek-V4-Flash` deployments.
- **Task routing** (`AIHOT_ENRICH_PROVIDER` / `_SCORE_PROVIDER` / `_EMBED_PROVIDER`) — enrich/score default to `azure-deepseek`; embeddings default to `azure-openai`.
- **LLM safety knobs** (`LLM_CALL_TIMEOUT_MS`) — optional per-call timeout override; default is 90s.
- **Fallback providers** (`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`) — wired but not on the default production route.

### Roadmap status

| Milestone | Scope | Status |
|---|---|---|
| **M0 — Shell** | Next.js i18n app + UI from screenshots + mock data | ✅ shipped |
| **M1 — Read-only ingestion** | Typed source catalog + fetcher + normalizer + live Sources page | ✅ shipped |
| **M2 — Enrich + Score + Cluster** | LLM summary + tags + 0-100 score + halfvec embeddings + pgvector dedup + live Hot News feed | ✅ shipped |
| **M3 — Feedback + Auth** | `feedback` table + admin gate + real metrics on 策略迭代 page (Supabase Auth → password gate in s6) | ✅ shipped |
| **M4 — Editorial agent** | Policy agent reads feedback, diffs `editorial.skill.md`, streams to console | ✅ shipped |
| **X ingestion** | 7 watched X accounts via API v2 pay-per-tweet, since_id cursor, retweets/replies filtered | ✅ shipped (s6) |
| **Content backfill** | Fill 2026 historical items from Wayback Machine + X historical (+2907 new items) | ✅ shipped (s7) |
| **Terminal design port** | Full ax-radar mock port: HKR rings, site-config panel, bilingual zh/en, 12 views on `<ViewShell>` | ✅ shipped (s7) |
| **Saved collections + server tweaks** | Named bookmark folders with inbox fallback; cross-device tweak/watchlist persistence via `users.tweaks` jsonb | ✅ shipped (s7) |
| **Cross-source event UI** | "Also reported by N sources" chips, canonical event titles, and event-level drawer/card data | ✅ shipped |
| **M5 — Low-follower viral** | Low-follower viral detector once source APIs make follower/impression data affordable | planned |
| **AI HOT integration + daily voice rebase** | New `aihot-api` source (hourly pre-curated pool from https://aihot.virxact.com) + AI HOT structured daily merged into column generator + friend-sharing daily/commentary voice + cost-bounded backfill scripts | ✅ shipped (2026-05-08, voice refreshed 2026-06-10) |
| **Tier-gated commentary** | `editor_note_*` (一句话点评) runs for every non-excluded item / event; `editor_analysis_*` only for tier ∈ (featured, p1) — tier 'all' takes a note-only LLM call via `commentaryNoteSchema` (~85% smaller output) | ✅ shipped (2026-05-08) |
| **DeepSeek treatment rebase + paper retirement** | DeepSeek V4 Pro/Flash importance-tiered treatment, friend-readable zh/en prose prompts, Chinese/daily backfills, and complete retirement of paper sources/routes/RSS/MCP/DB rows | ✅ shipped (2026-06-10) |
| **LLM usage guardrails + observability** | Enrich claim/backoff fields prevent duplicate cron/backfill LLM spend; usage admin/API/MCP now include all-time totals plus task/model breakdowns and recent-call model labels | ✅ shipped (2026-06-11) |
| **Editorial taxonomy rebrand** | 深度解读 → 锐评 (200 字 cap, was 300-500 字 / 800 ceiling); summary tightened to 50-90 字 一句话总结; UI labels rebranded (编辑点评 → 一句话点评). Home page default flipped from multi-day "3 stories per day" digest to today's hot events; daily digest reachable via `?view=daily` toggle | ✅ shipped (2026-05-08) |
| **Agent access — public mirror** | Anonymous `/api/public/*` mirror (8 read-only endpoints: feed / items / search / sources / events / daily / dailies) with IP rate limit + weak ETag + CORS. Discovery: hosted `/skill.md` (SKILL.md standard) + `/openapi.yaml` (OpenAPI 3.1) + `/robots.txt` + `/sitemap.xml`. Bilingual `/{locale}/agents` page with 3-tab UI (Skill / RSS / REST API). Bearer-gated `/api/v1/*` + `/api/mcp` retained for write actions + audit | ✅ shipped (2026-05-13, PR #36) |

Docs routing starts at [`docs/README.md`](./docs/README.md). Full blueprint + deviations live in [`docs/architecture/ingestion.md`](./docs/architecture/ingestion.md). AI HOT integration design is in [`docs/aihot-integration/PLAN.md`](./docs/aihot-integration/PLAN.md). Agent access surface is in [`docs/agent-access/`](./docs/agent-access/). Current handoff notes are in [`docs/HANDOFF.md`](./docs/HANDOFF.md).

---

## 中文

### 它是什么

AX 的 AI 雷达是一款面向 AI 行业编辑和分析师的情报工作台，由四个环节组成：

1. **拉取**：已监控的精选信源目录（RSS / Atom / RSSHub / API / 网页抓取）——厂商博客、媒体、新闻信、深度报告、社交信号、播客、政策、市场和产品源。
2. **加工**：每篇内容经 LLM 管线处理——中英文摘要、像朋友分享一样的点评、0–100 的 importance 分数、多轴标签（能力 / 实体 / 话题）和跨源聚类。
3. **精选**：以人类可读的 `editorial.skill.md` 作为精选策略。编辑点 👍 / 👎 / ⭐ 并写文字反馈。
4. **策略自迭代**：Claude Agent 读取累积的反馈，生成 `editorial.skill.md` 的 diff，编辑审核后发布为下一个版本，Worker 下次 enrich 自动使用新策略。

### 页面入口

| 路由 | 说明 |
|---|---|
| `/{locale}` | 热点资讯 — HKR 分数环 + 等级/信源过滤 + 自动滚动头条 |
| `/{locale}/all` | 全部 — 所有未排除的内容，共用信源过滤 |
| `/{locale}/x-monitor` | X 监控 — 7 个账号侧栏 + 时间线 |
| `/{locale}/saved` | 收藏 — **自定义收藏夹**，支持收件箱、标签、移动、导出 Markdown |
| `/{locale}/sources` | 信源 — 分组表格或卡片网格（`?view=cards`） |
| `/{locale}/podcasts` | 播客 · 视频 — 节目流 + 频道过滤 |
| `/{locale}/agents` | Agent 接入 — 3-tab 集成页面（Skill / RSS / REST API），见 [`docs/agent-access/`](./docs/agent-access/) |
| `/{locale}/admin/usage` | 用量 — LLM 花费卡片（今日 / 7 天 / 30 天 / 全量）、任务/模型拆分、最近调用模型 |
| `/{locale}/admin/system` | 系统 — 信源健康、队列、cron 状态和近期错误 |
| `/{locale}/admin/iterations` | 策略迭代 — 指标卡片 + Agent 控制台 + Diff 预览 + **版本时间轴** |
| `/{locale}/admin/policy` | 精选策略 — **可编辑** markdown，带实时预览，可直接提交新版本 |
| `/{locale}/admin/users` | 用户管理（coming soon，当前单用户模式） |

### 技术栈

Next.js 16（App Router + Turbopack + Fluid Compute）· React 19 · TypeScript · Tailwind v4 · next-intl v4 · Radix Slot · Lucide · Vercel AI SDK v6（Azure DeepSeek V4 Pro/Flash 负责正文与评分，Azure OpenAI `text-embedding-3-large` 负责嵌入）· Supabase Postgres + drizzle + pgvector 0.8（halfvec + HNSW）· Vercel Cron（11 个 route handlers）· Bun。

### 设计系统

终端风格指挥中心配色 — 绿橙蓝多重强调色 + HKR 环形分数 + JetBrains Mono + Noto 衬线/黑体 SC。变量在 [`app/globals.css`](./app/globals.css)，布局在 [`app/terminal.css`](./app/terminal.css)。界面内可通过 `⌥,` 快捷键唤出站点配置面板，实时切换 4 主题 × 6 强调色 × 4 圆角 × 3 外壳样式 × 4 分数视图。

### 本地启动

```bash
cp .env.example .env.local
# 编辑 .env.local 填入各家 Key

bun install
bun run dev
# 打开 http://localhost:3000 → 自动跳转到 /zh
```

### 路线图

| 里程碑 | 范围 | 状态 |
|---|---|---|
| **M0 — 骨架** | 双语 UI + mock 数据 | ✅ 已发布 |
| **M1 — 只读接入** | 类型化信源目录 + fetcher + normalizer + 实时 /sources | ✅ 已发布 |
| **M2 — 加工评分聚类** | LLM 摘要 / 标签 / 0-100 分 / 向量嵌入 / 去重 / 实时热点 | ✅ 已发布 |
| **M3 — 反馈 + 鉴权** | feedback 表 + 管理员鉴权（s6 由 Supabase 改为密码门）+ 策略迭代真实指标 | ✅ 已上线 |
| **M4 — 编辑 agent** | Agent 读反馈、改策略、审核 diff、提交 v-next | ✅ 已上线 |
| **X 采集** | 7 个重点账号 via X API v2，since_id 增量、转推/回复已过滤 | ✅ 已上线 (s6) |
| **内容回填** | Wayback Machine + X 历史（新增 2907 条） | ✅ 已上线 (s7) |
| **终端设计迁移** | 完整迁移 ax-radar 设计：HKR 环、站点配置面板、双语支持，12 个页面 | ✅ 已上线 (s7) |
| **收藏夹 + 服务端配置** | 自定义收藏夹、收件箱兜底；跨设备的 `users.tweaks` 配置同步 | ✅ 已上线 (s7) |
| **M5 — 低粉爆文 / 聚类 UI** | 低粉爆文探测（待 X 高级搜索）、"N 个信源都报道了" | 计划中 |
| **AI HOT 接入 + 日报文风重写** | 新增 `aihot-api` 信源类型（hourly 拉取卡兹克 https://aihot.virxact.com 精选池）+ 把他们的结构化日报作为 must-cover 基线 merge 进我们的 column generator + 日报/点评改成朋友分享口吻 + 带成本上限的 backfill 脚本 | ✅ 已上线 (2026-05-08，文风 2026-06-10 刷新) |
| **分级评论 (tier-gated commentary)** | `editor_note_*` (一句话点评) 对每条非 excluded 都生成；`editor_analysis_*` 只对 tier ∈ (featured, p1) 生成 — tier='all' 走 note-only LLM 调用 (`commentaryNoteSchema`，输出量减少约 85%) | ✅ 已上线 (2026-05-08) |
| **DeepSeek 分层处理 + 论文源退役** | DeepSeek V4 Pro/Flash 按重要度分层处理，中英文都改成朋友分享口吻；中文内容、分数理由、点评、聚类、51 期日报已回填；论文源、论文路由、RSS/MCP/API 暴露和 DB 历史行已清理 | ✅ 已上线 (2026-06-10) |
| **LLM 用量护栏 + 可观测性** | enrich worker 先在 Postgres claim 再花 token，并带退避/重试上限；用量后台/API/MCP 增加全量总计、任务/模型拆分、最近调用模型标签 | ✅ 已上线 (2026-06-11) |
| **编辑分层重命名** | 深度解读 → 锐评 (200 字硬上限, 原 300-500 字 / 800 字顶); summary 收紧到 50-90 字 一句话总结; UI 标签重命名 (编辑点评 → 一句话点评). 主页默认从多日"每日精选"切换到今日热点; 每日精选可通过 `?view=daily` toggle 找回 | ✅ 已上线 (2026-05-08) |
| **Agent 接入 — 公开镜像** | 匿名 `/api/public/*` 只读镜像（8 个端点：feed / items / search / sources / events / daily / dailies）+ IP 限流 + 弱 ETag + CORS。发现层：托管 `/skill.md` (SKILL.md 标准) + `/openapi.yaml` (OpenAPI 3.1) + `/robots.txt` + `/sitemap.xml`。双语 `/{locale}/agents` 三 tab 页面 (Skill / RSS / REST API)。Bearer-gated `/api/v1/*` + `/api/mcp` 保留给写动作 + 审计 | ✅ 已上线 (2026-05-13, PR #36) |

文档路由入口见 [`docs/README.md`](./docs/README.md)。完整蓝图与偏差记录见 [`docs/architecture/ingestion.md`](./docs/architecture/ingestion.md)。AI HOT 集成设计见 [`docs/aihot-integration/PLAN.md`](./docs/aihot-integration/PLAN.md)。Agent 接入设计见 [`docs/agent-access/`](./docs/agent-access/)。当前会话交接记录见 [`docs/HANDOFF.md`](./docs/HANDOFF.md)。

---

## License

Private / WIP. Do not redistribute.
