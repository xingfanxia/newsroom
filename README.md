# AX's AI RADAR

> **A bilingual AI intelligence radar with a self-iterating editorial agent.** 50+ sources in, curated signal out.
> Terminal-forward command-center aesthetic with HKR score rings; JetBrains Mono + Noto Sans/Serif SC; zh/en locale-first.

🌐 **Live**: [newsroom-orpin.vercel.app](https://newsroom-orpin.vercel.app) → redirects to `/zh`
📦 **Repo**: [github.com/xingfanxia/newsroom](https://github.com/xingfanxia/newsroom)

[中文](#中文) · [English](#english)

---

## English

### What it is

AX's AI RADAR is a dashboard for editors and analysts who cover the AI industry. It does four things:

1. **Ingests** ~50 curated sources (RSS, Atom, RSSHub, APIs, scraping) — vendor blogs, media, newsletters, arXiv, social signal, podcasts.
2. **Enriches** each story via LLM — Chinese / English summary, 0–100 importance score, multi-axis taxonomy (capability / entity / topic), cross-source clustering, and optional [Tavily](https://tavily.com/) web-context.
3. **Curates** with a human-readable `editorial.skill.md` policy file. Editors click 👍 / 👎 / ⭐ and add notes.
4. **Iterates itself** — a Claude Agent reads accumulated feedback, diffs `editorial.skill.md`, shows the change for approval, and ships it as v-next. Workers pick up the new policy on the next enrichment pass.

### Surfaces

| Route | Purpose |
|---|---|
| `/{locale}` | 热点资讯 / Hot News — curated timeline with HKR rings + tier/source filters + auto-scroll ticker |
| `/{locale}/all` | 全部 / All Posts — everything non-excluded, same source filter |
| `/{locale}/low-follower` | 低粉爆文 (coming-soon — blocked on X search API tier) |
| `/{locale}/x-monitor` | X 监控 — 7 tracked handles with per-handle sidebar + firehose feed |
| `/{locale}/saved` | 收藏 — **user-named collections** with inbox + tags + move/export MD |
| `/{locale}/sources` | 信源 — grouped tables or card grid (`?view=cards`) |
| `/{locale}/podcasts` | 播客 · 视频 — podcast/video feed with per-channel filter pills |
| `/{locale}/admin/usage` | 用量 — LLM spend cards (today / 7d / 30d) |
| `/{locale}/admin/system` | 系统 — Detailed LLM cost + recent calls |
| `/{locale}/admin/policy` | 精选策略 — **editable** markdown with live preview; commits new version |
| `/{locale}/admin/iterations` | 策略迭代 — metric cards + agent console + diff preview + **version timeline** |
| `/{locale}/admin/users` | 用户 (coming soon) |

### Tech stack

- **Next.js 16** (App Router, Turbopack, Fluid Compute), **React 19**, **TypeScript**
- **Tailwind v4** (CSS-first design tokens in `globals.css`)
- **next-intl** v4 for `zh` / `en` routing and messages
- **Radix UI** primitives + `lucide-react` icons
- **Supabase Postgres** + **drizzle-orm** + **pgvector 0.8** (`halfvec(3072)` + HNSW)
- **Vercel AI SDK v6** unifies LLM + embedding access across providers:
  - Azure OpenAI GPT-5.4 standard (enrich + score + embeddings) via `@ai-sdk/azure`
  - Azure OpenAI GPT-5.4 pro (reserved for M4 agent) via `@ai-sdk/openai` + baseURL override
  - Anthropic Claude Opus 4.7 + Google Gemini 3.1 Pro Preview wired as optional fallbacks
- **Vercel Cron** triggers 6 route handlers (fetch hourly/daily/weekly + normalize + enrich every 15 min + cluster every 30 min)
- **bun** for install / build / dev / tests

### Design system

Terminal-forward command-center aesthetic — green/orange/blue accents on a near-black canvas, JetBrains Mono for Latin + Noto Sans/Serif SC for CJK, HKR circular score rings, `.shell` grid with left nav + main + optional right rail, auto-scrolling ticker, radar-sweep widget. Tokens in [`app/globals.css`](./app/globals.css); full layout rules in [`app/terminal.css`](./app/terminal.css). Live-configurable via the site-config panel (⌥, to open) with 4 themes × 6 accents × 4 radii × 3 chrome styles × 4 score visuals.

### Data ingestion & AI pipeline

Blueprint in [`docs/architecture/ingestion.md`](./docs/architecture/ingestion.md). Source catalog in [`lib/sources/catalog.ts`](./lib/sources/catalog.ts). Editorial policy lives at [`modules/feed/runtime/policy/skills/editorial.skill.md`](./modules/feed/runtime/policy/skills/editorial.skill.md).

### Local setup

```bash
# 1. copy env template and fill in keys
cp .env.example .env.local
# edit .env.local to add ANTHROPIC_API_KEY, GEMINI_API_KEY, AZURE_OPENAI_*, TAVILY_API_KEY

# 2. install + dev
bun install
bun run dev

# open http://localhost:3000 → redirects to /zh
```

### Environment variables

See [`.env.example`](./.env.example) for the complete template. On Vercel, most values are auto-provisioned by the Supabase Marketplace integration + the initial deploy — run `vercel env pull .env.local --yes` to sync locally. Key groups:

- **Supabase** (`POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`, `SUPABASE_*`) — auto-wired by Marketplace.
- **Azure OpenAI standard** (`AZURE_OPENAI_API_KEY` / `_ENDPOINT` / `_DEPLOYMENT` / `_EMBEDDING_DEPLOYMENT`) — handles all M2 inference.
- **Azure OpenAI pro** (`AZURE_OPENAI_PRO_*`) — reserved for M4 editorial agent.
- **Task routing** (`AIHOT_ENRICH_PROVIDER` / `_SCORE_PROVIDER` / `_EMBED_PROVIDER`) — all default to `azure-openai`.
- **Fallback providers** (`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `TAVILY_API_KEY`) — wired but unused by M2.

### Roadmap status

| Milestone | Scope | Status |
|---|---|---|
| **M0 — Shell** | Next.js i18n app + UI from screenshots + mock data | ✅ shipped |
| **M1 — Read-only ingestion** | 41 RSS/Atom/RSSHub sources + fetcher + normalizer + live Sources page | ✅ shipped |
| **M2 — Enrich + Score + Cluster** | Azure LLM summary + tags + 0-100 score + halfvec embeddings + pgvector dedup + live Hot News feed | ✅ shipped |
| **M3 — Feedback + Auth** | `feedback` table + admin gate + real metrics on 策略迭代 page (Supabase Auth → password gate in s6) | ✅ shipped |
| **M4 — Editorial agent** | Azure Pro agent reads feedback, diffs `editorial.skill.md`, streams to console | ✅ shipped |
| **X ingestion** | 7 watched X accounts via API v2 pay-per-tweet, since_id cursor, retweets/replies filtered | ✅ shipped (s6) |
| **Content backfill** | Fill 2026 historical items from Wayback Machine + ArXiv + X historical (+2907 new items) | ✅ shipped (s7) |
| **Terminal design port** | Full ax-radar mock port: HKR rings, site-config panel, bilingual zh/en, 12 views on `<ViewShell>` | ✅ shipped (s7) |
| **Saved collections + server tweaks** | Named bookmark folders with inbox fallback; cross-device tweak/watchlist persistence via `users.tweaks` jsonb | ✅ shipped (s7) |
| **M5 — Low-follower viral + cluster UI** | Low-follower viral detector (X `search/all` quota), "also reported by N sources" chips | planned |

Full blueprint + deviations in [`docs/architecture/ingestion.md`](./docs/architecture/ingestion.md). Handoff notes in [`docs/HANDOFF.md`](./docs/HANDOFF.md).

---

## 中文

### 它是什么

AX 的 AI 雷达是一款面向 AI 行业编辑和分析师的情报工作台，由四个环节组成：

1. **拉取**：大约 50 个精选信源（RSS / Atom / RSSHub / API / 网页抓取）——厂商博客、媒体、新闻信、arXiv、社交信号、播客。
2. **加工**：每篇内容经 LLM 管线处理——中英文摘要、0–100 的 importance 分数、多轴标签（能力 / 实体 / 话题）、跨源聚类；可选 [Tavily](https://tavily.com/) 网页上下文补充。
3. **精选**：以人类可读的 `editorial.skill.md` 作为精选策略。编辑点 👍 / 👎 / ⭐ 并写文字反馈。
4. **策略自迭代**：Claude Agent 读取累积的反馈，生成 `editorial.skill.md` 的 diff，编辑审核后发布为下一个版本，Worker 下次 enrich 自动使用新策略。

### 页面入口

| 路由 | 说明 |
|---|---|
| `/{locale}` | 热点资讯 — HKR 分数环 + 等级/信源过滤 + 自动滚动头条 |
| `/{locale}/all` | 全部 — 所有未排除的内容，共用信源过滤 |
| `/{locale}/low-follower` | 低粉爆文（即将推出 — 待 X 高级搜索配额） |
| `/{locale}/x-monitor` | X 监控 — 7 个账号侧栏 + 时间线 |
| `/{locale}/saved` | 收藏 — **自定义收藏夹**，支持收件箱、标签、移动、导出 Markdown |
| `/{locale}/sources` | 信源 — 分组表格或卡片网格（`?view=cards`） |
| `/{locale}/podcasts` | 播客 · 视频 — 节目流 + 频道过滤 |
| `/{locale}/admin/usage` | 用量 — LLM 花费卡片（今日 / 7 天 / 30 天） |
| `/{locale}/admin/iterations` | 策略迭代 — 指标卡片 + Agent 控制台 + Diff 预览 + **版本时间轴** |
| `/{locale}/admin/policy` | 精选策略 — **可编辑** markdown，带实时预览，可直接提交新版本 |

### 技术栈

Next.js 16（App Router + Turbopack + Fluid Compute）· React 19 · TypeScript · Tailwind v4 · next-intl v4 · Radix UI · Lucide · Vercel AI SDK v6（Azure OpenAI GPT-5.4 standard + pro）· Supabase Postgres + drizzle + pgvector 0.8（halfvec + HNSW）· Vercel Cron（6 定时任务）· Bun。

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
| **M1 — 只读接入** | 41 个信源 + fetcher + normalizer + 实时 /sources | ✅ 已发布 |
| **M2 — 加工评分聚类** | Azure 摘要 / 标签 / 0-100 分 / 向量嵌入 / 去重 / 实时热点 | ✅ 已发布 |
| **M3 — 反馈 + 鉴权** | feedback 表 + 管理员鉴权（s6 由 Supabase 改为密码门）+ 策略迭代真实指标 | ✅ 已上线 |
| **M4 — 编辑 agent** | Agent 读反馈、改策略、审核 diff、提交 v-next | ✅ 已上线 |
| **X 采集** | 7 个重点账号 via X API v2，since_id 增量、转推/回复已过滤 | ✅ 已上线 (s6) |
| **内容回填** | Wayback Machine + ArXiv + X 历史（新增 2907 条） | ✅ 已上线 (s7) |
| **终端设计迁移** | 完整迁移 ax-radar 设计：HKR 环、站点配置面板、双语支持，12 个页面 | ✅ 已上线 (s7) |
| **收藏夹 + 服务端配置** | 自定义收藏夹、收件箱兜底；跨设备的 `users.tweaks` 配置同步 | ✅ 已上线 (s7) |
| **M5 — 低粉爆文 / 聚类 UI** | 低粉爆文探测（待 X 高级搜索）、"N 个信源都报道了" | 计划中 |

完整蓝图与偏差记录见 [`docs/architecture/ingestion.md`](./docs/architecture/ingestion.md)。会话交接记录见 [`docs/HANDOFF.md`](./docs/HANDOFF.md)。

---

## License

Private / WIP. Do not redistribute.
