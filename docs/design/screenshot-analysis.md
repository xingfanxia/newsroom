# AI·HOT — Screenshot Analysis & Product Blueprint

> Source screenshots: `docs/design/reference-screenshots/01-06.jpg`
> Generated: 2026-04-16 — informs product scope, design system, and data-source catalog.

---

## 1. What is this product?

**AI·HOT (AI·HOT 热点资讯)** is an **AI-native news intelligence platform** for an editor/analyst persona who needs to stay on top of the AI industry. It is NOT a passive RSS reader. The distinguishing feature — visible across screenshots 2–6 — is a **self-iterating editorial agent**: a Claude-powered agent that reads human feedback (thumbs up/down + notes), reviews its current curation policy (`editorial.skill.md`), produces a **diff**, shows it for approval, then ships the new version as v-next. Every story shown in the product has been run through an AI enrichment pipeline before reaching the human.

Core product thesis: *"news curation policy is code, and the agent that writes the code improves itself from your taste."*

### Personas
- **Editor (primary)** — curates the daily AI/tech digest, trains the agent's taste by clicking 👍/👎.
- **Analyst / reader (secondary)** — consumes the curated feed; can favorite, search, and filter.
- **Operator (admin)** — manages sources (信源), users (用户), and the backend policy lifecycle.

---

## 2. Screen-by-screen breakdown

### Screen 01 — `热点资讯` (Hot News Timeline) — *primary consumer view*
**File:** `reference-screenshots/01-hot-news-timeline.jpg`

- **Header**: title "热点资讯" + subtitle "精选·AI 自动挑选的高价值内容·本页 40 条" + right-side tab group `精选 | 全部 | P1` (filter by importance tier).
- **Search row**: search input "搜索标题/摘要…" + cyan `筛选` (filter) button.
- **Timeline body**: date headers (e.g., `3月24日`), timestamp gutter on left (`21:59`, `17:00`, `05:51`, `03:57`), each timestamp anchored to a card via a dot-on-rail visual.
- **Story card** (the atomic unit of the product):
  - **Source meta line**: `Anthropic: Research（发表成果·网页）` — publisher + content-kind + medium, parenthesized.
  - **Curation pill**: `精选` (selected) — the agent marked this as featured.
  - **Title**: bold 18–20px, e.g., `逆向分析Claude对CVE-2026-2796漏洞的利用程序`.
  - **AI-generated summary**: 2–3 sentences, ~200 chars Chinese. This is not a scraped description — the phrasing is analytic: *"本文深入探讨了... 该漏洞源于... 研究团队在仅提供虚拟机和验证器的条件下..."*.
  - **Tag row**: small rounded chips (`Agent`, `Anthropic`, `安全/对齐`) — AI-assigned taxonomy across three axes (capability, entity, topic).
  - **Importance score**: numeric badge (`85`, `88`, `82`) — green pill, top-right of card.
  - **Feedback controls**: 👍 / 👎 / ⭐ (bookmark).
  - **Cross-source signal** (screenshot 1, story 3): `另有 3 个源也报道了此事件` — dedup cluster indicator.

### Screen 02 — `策略迭代` (Strategy Iteration — Metrics & Feedback List)
**File:** `reference-screenshots/02-strategy-iteration-metrics.jpg`

- **Three metric cards**: `总反馈 10` (total feedback, white), `赞同 4` (agree, green), `反对 6` (disagree, amber). Each with one-line explanation.
- **Recent feedback list (`最近反馈 10 条`)**: every row is a story the editor rated, with the editor's handwritten note:
  - `👍 Claude Code 推出"自动模式"权限管理 — 最近Claude的内容的权重可以提高 — 31分钟前`
  - `👎 逆向分析Claude对CVE-2026-2796漏洞的利用程序 — 有点过于偏专业开发向了，不利于媒体传播 — 31分钟前`
  - `👎 安全地使用Sora进行创作 — 没什么用，Sora现在不是热点，还是跟安全相关，分数应该更低 — 22小时前`
  - `👎 为智能体工具实现快速正则表达式搜索：文本索引方法 — 过于技术了，普通人看不太懂 — 22小时前`
- Notes are **written in Chinese natural language** and **consumed by the agent as training signal**.
- Right column: relative timestamps (`31分钟前`, `22小时前`, `1天前`, `5天前`, `9天前`).

### Screen 03 — `迭代控制台` (Iteration Console — streaming agent log)
**File:** `reference-screenshots/03-iteration-console.jpg`

- Black console panel with colored bullet lines (dark circle dots in teal/yellow/muted):
  - 启动 Claude Agent...
  - 加载反馈数据...
  - 已加载 10 条反馈 (4 赞同 / 6 反对)
  - Agent 开始工作...
  - Agent 会话已建立
  - 我来按照工作流程操作。首先读取当前的 Skill 文件。
  - 读取文件: `modules/feed/runtime/policy/skills/editorial.skill.md`
  - Agent 工作中...
- This reveals the **agent architecture**:
  - Claude Agent SDK session
  - Named **Skill** file = `editorial.skill.md` at path `modules/feed/runtime/policy/skills/`
  - Agent has tool access to read/write that file
  - Streaming output surfaced to the editor in real time
- Below console: `变更预览` (change preview) section and `版本历史 0 个版本` (version history, 0 entries pre-run).

### Screen 04 — `变更预览` (Strategy Diff Preview — line-level)
**File:** `reference-screenshots/04-strategy-diff-preview.jpg`

Full-width monospace diff view. Example visible lines:
- `+ **普通读者无法理解或上手的内容** — 即便主题是 Agent 或热门领域，技术门槛过高也无法触达受众`
- `+ - 分段: | 定义 | 举例 |`
- `+ 95~100 | 行业地震级，所有 AI 媒体年会头条报道 | GPT-5 发布达成；Llama 4 开源；OpenAI/Anthropic 发生重大人事变动 |`
- `+ 85~94 | 值得立刻写文，当天则必须覆盖 | Claude 4.6 发布；ChatGPT 重大功能更新（如原生生图能力）；Cursor 炸 Agent 模式；知名大佬发长文谈 AGI 时间线 |`
- `+ 78~84 | 质量不错，值得推荐 | MCP 协议重大更新；一个很火的开源 Agent 框架；Sam Altman 的深度博客；一篇引发广泛讨论的 AI 安全论文 |`
- `+ 72~77 | 精选门槛刚触及，需结合来源权威度判断 | 不错的 AI 教程（如"用 Claude / Code / 写搭建 XX"）；中等产品更新（如某 AI 工具新增一个功能）；有洞察的观点文章 |`
- `+ 60~71 | 值得关注但通常不够精选 | 常规产品小更新；一般性行业报道；普通教程 |`
- `+ 40~59 | 低价值 | 旧闻重发；营销软文；付费课程推广；广告量很低的盘点文章 |`
- `+ < 40 | 噪音 | 日常闲聊博客；与 AI 基本无关的内容 |`
- `+ ---`
- `+ ### importance（对 AI 自媒体选题的重要性）`
- Then several `+` prefixed bullet rules and `-` (removed) lines are visible.
- Buttons: `确认应用` (primary cyan) + `取消` (secondary).
- **Takeaway**: the strategy is human-readable Markdown with **numeric importance bands + example criteria** — very similar in style to a Claude "skill" or system prompt with tabular thresholds.

### Screen 05 — Diff Completion + Toast
**File:** `reference-screenshots/05-diff-success-toast.jpg`

Shows detailed `### 具体修改` (specific modifications) section:
1. `**受众偏好** — 新增两条正向信号:`
   - Anthropic/Claude 实质性更新 → importance 上调 3~5 分
   - 国内主流 AI 公司（小米/百度/阿里等）发布新模型 → 应视同头部厂商合理评分
2. `**通常不精选的内容** — 新增 4 条明确规则:`
   - 技术实现细节过深（CVE逆向、底层算法）
   - 传统科学领域结合 AI 的研究（物理、科学计算等）
   - 云厂商促销性内容
   - 已过气话题（无重大突破则不选）
3. `**约束规则** — 新增**技术可及性检测**: 内容若需深度专业背景且无上手路径，importance 强制下调 10~15 分...`
4. `**从反馈学到的偏好** — 从空白到填入 5 条有时间戳的经验记录...`
- `### 未做的事（刻意保持克制）` section proves the agent refuses to overfit:
  - 没有修改 `论文/研究` 的门槛数字（82分），因为问题根源是 importance 打分过高...
  - 没有把具体案例（CVE编号、小米型号）写入规则——避免过拟合...
- Toast (bottom): `策略已更新为 v3, Worker 下次 enrich 将使用新策略。关闭` — **confirms a worker-based enrichment pipeline** and **semantic versioning of the curation policy**.

### Screen 06 — `策略迭代` Overview (top of page)
**File:** `reference-screenshots/06-strategy-overview.jpg`

- **Hero card**: title `策略迭代` + subtitle `用真实反馈推动策略更新。这里负责拉取反馈、生成草稿、审核 diff 和回滚版本。` + version pill `v3` + date `2026-03-25`.
- **Right card**: `迭代就绪度` → `已经具备迭代输入，可以开始生成新草稿` + helper text + two CTAs (`查看线上样本` cyan, `返回精选策略` outlined).
- Below: the same three metric cards + recent feedback list already described in screens 02 and 06.

---

## 3. Inventory of navigation items (sidebar)

| zh | en (inferred) | Implied surface |
|---|---|---|
| 热点资讯 | Hot News | Home — curated story timeline (screen 01) |
| 低粉爆文 | Low-follower Viral Posts | Discovery feed for small-account gems (e.g., Substack/微博 viral but low-reach) |
| X监控 | X Monitoring | Twitter/X watchlist of labs & researchers |
| 收藏 | Saved | User's bookmarked stories |
| 信源 | Sources | RSS/API/scraper feed catalog + health |
| **后台 (Admin)** | | *divider label* |
| 系统 | System | Ops: worker queue, schedules, logs |
| 精选策略 | Curation Policy | Current `editorial.skill.md` read-only view |
| 策略迭代 | Policy Iteration | Screens 02–06 — agent-assisted policy updates |
| 用户 | Users | Access control |
| 退出 | Logout | Footer |

---

## 4. AI capabilities embedded (observed)

| Capability | Evidence | Likely implementation |
|---|---|---|
| Article summarization | Every card has a 2–3 sentence Chinese abstract that is analytic, not copy-pasted | LLM call per ingested item; cached |
| Importance scoring (0–100) | Green pill numbers (82, 85, 88); diff screen shows explicit bands | LLM with rubric; rubric is the policy (`editorial.skill.md`) |
| Multi-axis tagging | Chips `Agent`, `Anthropic`, `安全/对齐`, `产品更新` across capability/entity/topic axes | LLM structured-output + controlled taxonomy |
| Cross-source clustering | `另有 3 个源也报道了此事件` | Embeddings + cosine similarity over title+summary; group threshold |
| Filter `精选` vs `全部` vs `P1` | Tab group on timeline header | Derived views: importance >= threshold; top P1 by score |
| Source/medium classification | Meta like `Anthropic: Research (发表成果·网页)`, `OpenAI: 官网动态 (RSS·排除企业/客户案例)` | LLM classification + per-source template |
| Agent-driven policy iteration | Screens 03–05: Claude Agent edits `editorial.skill.md` from feedback | Claude Agent SDK with file-read/file-write tools + feedback transcript |
| Dedup vs rewrite detection | Agent explicitly refuses to over-fit ("未做的事") | Explicit meta-reasoning step in the prompt / skill |
| Low-follower viral detection | `低粉爆文` sidebar item | Signal: engagement / follower_count ratio over threshold |

---

## 5. Data sources — broad catalog

Goal: populate the three consumer surfaces (`热点资讯`, `低粉爆文`, `X监控`) and the admin source catalog (`信源`).

### 5.1 Official vendor feeds (primary for AI industry news)
| Source | Route | Kind | Locale | Freq | Notes |
|---|---|---|---|---|---|
| Anthropic Blog | `https://www.anthropic.com/news/rss.xml` (fallback scrape) | RSS/scrape | en | daily | Research + product |
| Anthropic News Index | `https://www.anthropic.com/news` | scrape | en | daily | Categories: Research, Product, Policy |
| OpenAI Blog | `https://openai.com/news/rss.xml` | RSS | en | daily | |
| OpenAI Research | `https://openai.com/research` | scrape | en | daily | |
| Google DeepMind | `https://deepmind.google/discover/blog/rss.xml` | RSS | en | weekly | |
| Google Research | `https://research.google/blog/rss/` | RSS | en | weekly | |
| Meta AI Research | `https://ai.meta.com/blog/rss/` | RSS | en | weekly | |
| Mistral Blog | `https://mistral.ai/news` | scrape | en | sporadic | |
| Cohere Blog | `https://cohere.com/blog` | scrape | en | weekly | |
| xAI Blog | `https://x.ai/news` | scrape | en | sporadic | |
| Microsoft AI Blog | `https://blogs.microsoft.com/ai/feed/` | RSS | en | weekly | |
| NVIDIA Blog | `https://blogs.nvidia.com/feed/` | RSS | en | daily | |
| AWS ML Blog | `https://aws.amazon.com/blogs/machine-learning/feed/` | RSS | en | daily | |
| Hugging Face Blog | `https://huggingface.co/blog/feed.xml` | RSS | en | weekly | |
| LangChain Blog | `https://blog.langchain.dev/rss/` | RSS | en | weekly | |
| LlamaIndex | `https://www.llamaindex.ai/blog` | scrape | en | weekly | |

### 5.2 Chinese AI vendor feeds
| Source | Route | Kind | Locale |
|---|---|---|---|
| 小米技术 | `https://xiaomi.com/...` (via RSSHub `/xiaomi/blog`) | RSSHub | zh |
| 阿里达摩院 | DAMO Academy via RSSHub | RSSHub | zh |
| 百度研究院 | `research.baidu.com` via RSSHub | RSSHub | zh |
| 腾讯 AI Lab | via RSSHub `/tencent/ailab` | RSSHub | zh |
| 智谱 AI | `https://zhipuai.cn/` + WeChat via RSSHub | RSSHub | zh |
| 字节豆包 | via RSSHub | RSSHub | zh |
| 面壁智能 MiniCPM | GitHub releases + WeChat | multi | zh |
| 月之暗面 Kimi | Product blog + WeChat via RSSHub | RSSHub | zh |
| 深度求索 DeepSeek | HuggingFace + GitHub | multi | zh+en |
| Qwen / 通义 | HuggingFace + GitHub | multi | zh+en |

### 5.3 Media / publications
| Source | Route | Kind | Locale |
|---|---|---|---|
| Hacker News | `https://hnrss.org/frontpage`, `/bestcomments`, `/newest` | RSS | en |
| TechCrunch AI | `https://techcrunch.com/category/artificial-intelligence/feed/` | RSS | en |
| The Verge AI | `https://www.theverge.com/rss/ai-artificial-intelligence/index.xml` | RSS | en |
| Ars Technica | `https://arstechnica.com/ai/feed/` | RSS | en |
| Wired | `https://www.wired.com/feed/tag/ai/latest/rss` | RSS | en |
| MIT Technology Review | `https://www.technologyreview.com/feed/` | RSS | en |
| Import AI (Jack Clark) | `https://jack-clark.net/feed/` | RSS | en |
| The Batch (Andrew Ng) | `https://www.deeplearning.ai/the-batch/feed/` | RSS | en |
| Stratechery | `https://stratechery.com/feed/` | RSS | en (paid) |
| The Information AI | scrape | en (paid) |
| 36氪 AI频道 | RSSHub `/36kr/category/35` | RSSHub | zh |
| 虎嗅 AI | RSSHub `/huxiu/channel/ai` | RSSHub | zh |
| 少数派 AI | RSSHub `/sspai/matrix` | RSSHub | zh |
| 机器之心 | RSSHub `/jiqizhixin` | RSSHub | zh |
| 量子位 | RSSHub `/qbitai` | RSSHub | zh |
| 澎湃新闻科技 | `https://www.thepaper.cn/` via RSSHub | RSSHub | zh |
| 财新科技 | RSSHub | RSSHub | zh (paid) |
| 第一财经科技 | RSSHub | RSSHub | zh |
| 品玩 | RSSHub `/pingwest` | RSSHub | zh |

### 5.4 Newsletters (high signal, slow)
- Ben's Bites (`https://www.bensbites.com/feed`)
- AlphaSignal (`https://alphasignal.ai/`)
- TLDR AI (`https://tldr.tech/ai/rss`)
- Last Week in AI (`https://lastweekin.ai/feed`)
- Gradient Flow (`https://gradientflow.com/feed/`)
- 硅基流动 / AI早报 via 微信公众号 → RSSHub `/wechat/mp/msgalbum/{biz}`
- 量子位智库 / 机器之心Pro via 微信

### 5.5 Research papers
- **arXiv** `cs.AI`, `cs.CL`, `cs.LG`, `cs.NE` — `http://export.arxiv.org/api/query?search_query=cat:cs.AI&sortBy=submittedDate` (Atom)
- **Semantic Scholar** `/graph/v1/paper/search` (API)
- **Papers with Code** trending `https://paperswithcode.com/latest`
- **Hugging Face Papers** daily `https://huggingface.co/papers`
- **OpenReview** (NeurIPS/ICLR/ICML) API
- **AK's daily papers thread** (X/Twitter @_akhaliq)

### 5.6 Social / community signal
| Channel | Mechanism | Locale |
|---|---|---|
| **X/Twitter** watchlist (`X监控` surface) | X API v2 user tweets endpoint OR Apify actor (cost tradeoff); RSSHub `/twitter/user/{id}` deprecated but functional with session cookie | en+zh |
| X lists | X API list timeline | en+zh |
| Bluesky | `https://bsky.app/profile/{handle}/rss` (AT Proto RSS shim) | en |
| Mastodon | public RSS on any user/tag | en |
| Reddit (`r/MachineLearning`, `r/LocalLLaMA`) | RSS via `.rss` suffix on any listing | en |
| Weibo AI KOL list | RSSHub `/weibo/user/{uid}` | zh |
| 知乎热榜 | RSSHub `/zhihu/hotlist` | zh |
| 即刻 精选 | RSSHub `/jike/topic/{id}` | zh |
| 小红书 AI tag | RSSHub `/xiaohongshu/discover` (spotty) | zh |
| 微信公众号 | RSSHub `/wechat/{biz_id}` — requires cookie for most | zh |

### 5.7 Product / launch watch
- **Product Hunt** AI filter: `https://www.producthunt.com/feed?category=artificial-intelligence`
- **Indie Hackers** `https://www.indiehackers.com/feed.xml`
- **GitHub Trending** AI/ML — scrape `https://github.com/trending?since=daily&spoken_language_code=en` (no official RSS, use `https://github.com/trending.atom?since=daily` community mirror)
- **GitHub Releases** (per-repo) — `https://github.com/{owner}/{repo}/releases.atom`
- **npmjs trending** / **PyPI new releases** — `https://pypi.org/rss/updates.xml`
- **HuggingFace trending models/spaces** — `https://huggingface.co/api/trending`

### 5.8 Podcasts / video
| Channel | Route | Kind |
|---|---|---|
| Dwarkesh Patel | `https://www.dwarkeshpatel.com/feed` | RSS (audio) |
| Latent Space | `https://api.substack.com/feed/podcast/...` | RSS |
| No Priors | Spotify API / RSS | RSS |
| Lex Fridman | YouTube RSS `https://youtube.com/feeds/videos.xml?channel_id={id}` + Spotify | RSS |
| Training Data (Sequoia) | RSS | RSS |
| 小宇宙 AI 频道 | API `/v1/search/podcast` | API |
| Bilibili AI 区 | RSSHub `/bilibili/partion/...` | RSSHub |
| YouTube lab channels | YouTube RSS `videos.xml?channel_id=...` | RSS |

### 5.9 Conference / event trackers
- **ICML / NeurIPS / ICLR** — OpenReview API
- **AI Engineer Summit** — lu.ma listings via scrape
- **NVIDIA GTC** — press releases RSS
- **Anthropic / OpenAI DevDay** — official blog
- **CNCF AI-WG** — GitHub + YouTube

### 5.10 Regulatory / policy
- **EU AI Act** — `https://artificialintelligenceact.eu/feed/`
- **NIST AI RMF** — `https://www.nist.gov/ai` (scrape)
- **中国网信办** AI policy — gov.cn RSS (spotty)
- **US Executive Orders** — `whitehouse.gov` RSS

### 5.11 Market / funding signal
- **Crunchbase** daily digest (paid API)
- **PitchBook** AI sector (paid)
- **The AI Report** (funding tracker) — newsletter
- **China Money Network** — RSS

---

## 6. Design system recommendation

**Pick: Linear.app, with a custom cyan-neon accent palette.**

### Why Linear
- Content-first dark-mode-native aesthetic — matches screenshot backgrounds (`#08–0e` range).
- Information-dense card layouts with semi-transparent white borders — matches the story-card style.
- Inter Variable + 510 signature weight — perfect for long Chinese + English mixed content (Inter has excellent CJK fallback via `-apple-system, "PingFang SC"`).
- Tight letter-spacing at display sizes + comfortable body reading sizes — scales across the timeline + diff views.
- Linear's own palette is achromatic + single indigo accent; our screenshots use achromatic + single cyan accent. Same architecture, different hue.

### Palette delta (Linear → AI·HOT)
| Role | Linear | AI·HOT | Reason |
|---|---|---|---|
| Brand primary | `#5e6ad2` indigo | `#3ee6e6` neon cyan | Matches sidebar active state + primary buttons in screenshots |
| Brand hover | `#828fff` | `#5ef5f5` | Lighter cyan |
| Brand dim (text-on-bg) | `#7170ff` | `#22c7c7` | Accessibility on elevated surfaces |
| Success/positive | `#27a644` | keep green `#22c55e` | Thumbs-up color in screenshots |
| Danger/negative | N/A | add `#ef4444` | Thumbs-down color in screenshots |
| Warning | N/A | add `#f59e0b` | Reserved for `P1` / attention pills |
| Score-badge bg | N/A | `rgba(34, 197, 94, 0.14)` | Score pill in screenshots |
| Background base | `#08090a` | `#0a0d14` | Cooler, more blue |
| Background panel | `#0f1011` | `#0f1420` | Slightly elevated navy |
| Background elevated | `#191a1b` | `#111a2b` | Card/hero card |
| Border default | `rgba(255,255,255,0.08)` | keep | |
| Border subtle | `rgba(255,255,255,0.05)` | keep | |
| Glow (new) | — | `0 0 24px rgba(62,230,230,0.18)` | Active nav item + primary button in screenshots have soft cyan glow |

### What stays from Linear verbatim
- Typography scale + Inter Variable + OpenType features `cv01 ss03`
- 510 signature weight
- Semi-transparent border philosophy
- 8px spacing grid
- Elevation-via-luminance-stepping (not shadows)
- Radii scale (2/4/6/8/12/22/9999/50%)

### What's new for AI·HOT
- **Cyan glow** on primary interactive surfaces — softly pulsing on focus, instant on hover.
- **Score pill** component — green gradient with monospaced numerals.
- **Timeline rail** — vertical 1px line with 6px dots at each story anchor; dot color = dim cyan.
- **Diff viewer** — monospace Berkeley Mono, green `+` lines on `rgba(34,197,94,0.06)` bg, red `-` lines on `rgba(239,68,68,0.06)` bg, unchanged lines muted.
- **Status dot** — 6px circle for agent log bullets; colors: teal=info, amber=reading, muted=done.

---

## 7. Bilingual structure (en / zh)

### Routing
- `/` → locale negotiation (Accept-Language + cookie) → redirect to `/zh` or `/en`.
- `/{locale}/...` for every page: `/zh/feed`, `/en/feed`, `/zh/sources`, etc.
- Chinese is the **primary** locale (screenshots are all zh); English is a professional secondary.

### What gets translated
- All **chrome** (nav, buttons, tab labels, toasts, empty states, error messages).
- All **product UX strings** (tooltips, help text, placeholder text).
- **Category names** (`精选` / `Featured`, `全部` / `All`, `P1` stays as `P1`).
- **Date formats** (`3月24日` ↔ `Mar 24`; relative time `31分钟前` ↔ `31 min ago`).
- Number formatting (`10 条` ↔ `10 items`).

### What stays in source language
- Story titles, summaries, tags — stay in whatever language the AI pipeline produced them in (usually Chinese for the audience). Future: auto-translate on demand.
- Brand names (Anthropic, OpenAI, Claude) — never translated.
- Source meta like `官网动态（RSS·排除企业/客户案例）` — tag-taxonomy is editor-defined; we surface verbatim.
- Numeric score badges.

### Locale-specific streams
- `信源` (sources) page has a **locale filter** — `zh only / en only / all` — because English reader doesn't want 36氪 noise and vice versa.
- Podcasts + 微信公众号 only appear in zh locale by default.
- Hacker News + arXiv appear in both.

---

## 8. Component inventory (to build)

Core primitives (shadcn/ui):
1. `Button` — variants: `primary` (cyan), `ghost`, `outline`, `icon`
2. `Card` — elevated-surface container
3. `Input` — text, search
4. `Badge` — tag chip, score pill, version pill
5. `Tabs` — filter tabs (精选/全部/P1)
6. `Tooltip`
7. `Separator`
8. `ScrollArea`

Feature components:
9. `SidebarNav` — with divider-label (`后台`) + active glow state
10. `LocaleSwitcher` — zh/en toggle in top-right
11. `LogoMark` — `AI·HOT` SVG with spinning dot
12. `TimelineRail` — vertical gutter with timestamps + dots
13. `StoryCard` — the atomic unit: meta + title + summary + tags + score + actions
14. `ScoreBadge` — green-pill numeric with animated count-up on new items
15. `TagChip` — small rounded rect taxonomy tag
16. `FeedbackControls` — 👍/👎/⭐ with optimistic state
17. `CrossSourceIndicator` — "另有 N 个源也报道了此事件"
18. `MetricCard` — big-number stat
19. `FeedbackListItem` — icon + title + note + timestamp
20. `AgentConsole` — streaming bullet log
21. `DiffViewer` — monospace `+`/`-`/context line renderer
22. `VersionPill` — `v3` tag with dot
23. `ToastSuccess` — bottom cyan toast
24. `EmptyState`
25. `SourceRow` — for `信源` catalog page

---

## 9. Non-goals / deferred

- Real ingestion workers (documented in `docs/architecture/ingestion.md`).
- Real agent-driven policy iteration (documented as blueprint, UI built on mock data).
- User auth, roles, multi-tenancy.
- Mobile layout (desktop-first; basic responsive fallback at tablet).
- Payment / subscription.

Initial deployment is a **functional dashboard shell with mock data that convincingly demonstrates the end-state vision.**
