# AI·HOT — AI Newsroom

> **A bilingual AI-native news intelligence dashboard with a self-iterating editorial agent.**
> Inspired by Linear's dark-mode-native architecture; cyan-neon accent; zh/en locale-first.

🌐 **Live**: [newsroom-orpin.vercel.app](https://newsroom-orpin.vercel.app) → redirects to `/zh`
📦 **Repo**: [github.com/xingfanxia/newsroom](https://github.com/xingfanxia/newsroom)

[中文](#中文) · [English](#english)

---

## English

### What it is

AI·HOT is a dashboard for editors and analysts who cover the AI industry. It does four things:

1. **Ingests** ~50 curated sources (RSS, Atom, RSSHub, APIs, scraping) — vendor blogs, media, newsletters, arXiv, social signal, podcasts.
2. **Enriches** each story via LLM — Chinese / English summary, 0–100 importance score, multi-axis taxonomy (capability / entity / topic), cross-source clustering, and optional [Tavily](https://tavily.com/) web-context.
3. **Curates** with a human-readable `editorial.skill.md` policy file. Editors click 👍 / 👎 / ⭐ and add notes.
4. **Iterates itself** — a Claude Agent reads accumulated feedback, diffs `editorial.skill.md`, shows the change for approval, and ships it as v-next. Workers pick up the new policy on the next enrichment pass.

### Surfaces

| Route | Purpose |
|---|---|
| `/{locale}` | 热点资讯 / Hot News — curated timeline with importance scores + feedback controls |
| `/{locale}/low-follower` | 低粉爆文 — high-engagement posts from small accounts (coming soon) |
| `/{locale}/x-monitor` | X 监控 — watchlist of researchers & labs on X/Twitter (coming soon) |
| `/{locale}/saved` | 收藏 — bookmarked stories (coming soon) |
| `/{locale}/sources` | 信源 — full source catalog (40+ feeds) |
| `/{locale}/admin/system` | System queue and logs (coming soon) |
| `/{locale}/admin/policy` | Read-only view of the live `editorial.skill.md` |
| `/{locale}/admin/iterations` | Agent-assisted policy updates with diff preview |
| `/{locale}/admin/users` | Access control (coming soon) |

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

See [`DESIGN.md`](./DESIGN.md) — adapted from Linear's DESIGN.md with a cyan-neon accent. The reference inspiration screenshots are in [`docs/design/reference-screenshots/`](./docs/design/reference-screenshots/).

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
| **M3 — Feedback + Auth** | `feedback` table + Supabase Auth + real metrics on 策略迭代 page | ⏳ next |
| **M4 — Editorial agent** | Claude/Azure agent reads feedback, diffs `editorial.skill.md`, streams to console | planned |
| **M5 — X monitor + Low-follower + cluster UI** | X watchlist, viral detector, "also reported by N sources" chips | planned |

Full blueprint + deviations in [`docs/architecture/ingestion.md`](./docs/architecture/ingestion.md). Handoff notes in [`docs/HANDOFF.md`](./docs/HANDOFF.md).

---

## 中文

### 它是什么

AI·HOT 是一款面向 AI 行业编辑和分析师的情报工作台，由四个环节组成：

1. **拉取**：大约 50 个精选信源（RSS / Atom / RSSHub / API / 网页抓取）——厂商博客、媒体、新闻信、arXiv、社交信号、播客。
2. **加工**：每篇内容经 LLM 管线处理——中英文摘要、0–100 的 importance 分数、多轴标签（能力 / 实体 / 话题）、跨源聚类；可选 [Tavily](https://tavily.com/) 网页上下文补充。
3. **精选**：以人类可读的 `editorial.skill.md` 作为精选策略。编辑点 👍 / 👎 / ⭐ 并写文字反馈。
4. **策略自迭代**：Claude Agent 读取累积的反馈，生成 `editorial.skill.md` 的 diff，编辑审核后发布为下一个版本，Worker 下次 enrich 自动使用新策略。

### 页面入口

| 路由 | 说明 |
|---|---|
| `/{locale}` | 热点资讯 — 自动精选时间线，含 importance 分数和反馈按钮 |
| `/{locale}/low-follower` | 低粉爆文（即将推出） |
| `/{locale}/x-monitor` | X 监控（即将推出） |
| `/{locale}/saved` | 收藏（即将推出） |
| `/{locale}/sources` | 信源 — 完整信源目录 |
| `/{locale}/admin/iterations` | 策略迭代 — Agent 辅助策略更新 + Diff 预览 |
| `/{locale}/admin/policy` | 精选策略 — 当前 `editorial.skill.md` 只读视图 |

### 技术栈

Next.js 16（App Router + Turbopack + Fluid Compute）· React 19 · TypeScript · Tailwind v4 · next-intl v4 · Radix UI · Lucide · Vercel AI SDK v6（Azure OpenAI GPT-5.4 standard + pro）· Supabase Postgres + drizzle + pgvector 0.8（halfvec + HNSW）· Vercel Cron（6 定时任务）· Bun。

### 设计系统

见 [`DESIGN.md`](./DESIGN.md)，基于 Linear 的设计体系调整而来，主色由靛紫替换为霓虹青。参考截图在 [`docs/design/reference-screenshots/`](./docs/design/reference-screenshots/)。

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
| **M3 — 反馈 + 鉴权** | feedback 表 + Supabase Auth + 真实指标 | ⏳ 下一步 |
| **M4 — 编辑 agent** | Agent 读反馈、改策略、审核 diff | 计划中 |
| **M5 — X 监控 / 低粉爆文 / 聚类 UI** | 监控列表、高互动筛选、跨源展示 | 计划中 |

完整蓝图与偏差记录见 [`docs/architecture/ingestion.md`](./docs/architecture/ingestion.md)。会话交接记录见 [`docs/HANDOFF.md`](./docs/HANDOFF.md)。

---

## License

Private / WIP. Do not redistribute.
