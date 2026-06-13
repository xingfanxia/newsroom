"use client";
import { useState, type ReactNode } from "react";
import { useTweaks } from "@/hooks/use-tweaks";
import { toast } from "sonner";

type Tab = "skill" | "rss" | "api";
type Lang = "en" | "zh";

const SITE = "https://news.ax0x.ai";

export function AgentsTabs() {
  const { tweaks } = useTweaks();
  const lang: Lang = tweaks.language === "zh" ? "zh" : "en";
  const [tab, setTab] = useState<Tab>("skill");

  return (
    <div style={{ marginTop: 16 }}>
      <p style={leadStyle(lang)}>
        {lang === "zh"
          ? "让 Claude Code、RSS reader、任意 Agent 直接读到 AX Radar 的精选 AI 信号、AX 严选、每日 AI 日报。匿名免费、无需 token。"
          : "Bring AX Radar's curated AI signal, hand-picked editor stream, and daily AI columns into Claude Code, any RSS reader, or any agent. Free + anonymous — no token required."}
      </p>

      <TabNav tab={tab} setTab={setTab} lang={lang} />

      <div style={{ marginTop: 24 }}>
        {tab === "skill" && <SkillPane lang={lang} />}
        {tab === "rss" && <RssPane lang={lang} />}
        {tab === "api" && <ApiPane lang={lang} />}
      </div>

      <Caveats lang={lang} />
    </div>
  );
}

/* ============================================================================
 * Tab nav — 3 cards w/ overline + sub-label, cyan/green underline on active
 * ========================================================================= */

function TabNav({
  tab,
  setTab,
  lang,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
  lang: Lang;
}) {
  const items: Array<{ id: Tab; label: string; sub: string }> = [
    {
      id: "skill",
      label: "Skill",
      sub:
        lang === "zh"
          ? "任意 Agent · SKILL.md 标准"
          : "any agent · SKILL.md standard",
    },
    {
      id: "rss",
      label: "RSS",
      sub:
        lang === "zh"
          ? "任意 RSS reader · 零配置"
          : "any RSS reader · zero config",
    },
    {
      id: "api",
      label: "REST API",
      sub:
        lang === "zh"
          ? "开发者 / 自定义集成 · OpenAPI 3.1"
          : "developers · OpenAPI 3.1",
    },
  ];

  return (
    <div
      role="tablist"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
        gap: 1,
        background: "var(--border-1)",
        border: "1px solid var(--border-1)",
        borderRadius: 4,
        overflow: "hidden",
        marginTop: 18,
      }}
    >
      {items.map((it) => {
        const active = it.id === tab;
        return (
          <button
            key={it.id}
            role="tab"
            aria-selected={active}
            onClick={() => setTab(it.id)}
            style={{
              background: active
                ? "var(--bg-1)"
                : "rgba(255,255,255,0.01)",
              border: "none",
              cursor: "pointer",
              padding: "14px 16px 12px",
              textAlign: "left",
              borderBottom: active
                ? "2px solid var(--accent-green)"
                : "2px solid transparent",
              transition: "background 0.15s ease, border-color 0.15s ease",
            }}
          >
            <div
              style={{
                fontSize: 16,
                fontWeight: 600,
                color: active ? "var(--accent-green)" : "var(--fg-1)",
                fontFamily: "var(--font-mono)",
                marginBottom: 2,
              }}
            >
              {it.label}
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--fg-3)",
                fontFamily:
                  lang === "zh"
                    ? "var(--font-sans-cjk)"
                    : "var(--font-mono)",
                letterSpacing: "0.02em",
              }}
            >
              {it.sub}
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* ============================================================================
 * Pane 1: Skill
 * ========================================================================= */

function SkillPane({ lang }: { lang: Lang }) {
  const install = `帮我安装这个 skill: ${SITE}/skill.md`;

  return (
    <PaneShell
      overline={
        lang === "zh"
          ? "SKILL · 任意 AGENT · SKILL.MD 标准"
          : "SKILL · ANY AGENT · SKILL.MD STANDARD"
      }
      heading={
        lang === "zh" ? "一份 Skill,任何 Agent 都能用" : "One skill, any agent"
      }
      lang={lang}
    >
      <p style={bodyStyle(lang)}>
        {lang === "zh" ? (
          <>
            SKILL.md 标准格式,跨 Claude Code · Codex CLI · Cursor · Gemini CLI ·
            GitHub Copilot · OpenCode · Cline · Windsurf 等任意 Agent
            平台都能装。装好后用最自然的中文一句话拿到 AX Radar 数据,不需要
            API Key、不需要配 MCP server。
          </>
        ) : (
          <>
            SKILL.md standard format — installable on Claude Code, Codex CLI,
            Cursor, Gemini CLI, GitHub Copilot, OpenCode, Cline, Windsurf and
            any other agent platform. Just ask in natural language; no API key,
            no MCP setup.
          </>
        )}
      </p>

      <Subhead lang={lang} en="install" zh="安装" />
      <p style={subBodyStyle(lang)}>
        {lang === "zh"
          ? "在你的 Agent 里直接发这句话,Agent 会自己装到对应目录,不用你操心路径:"
          : "Send this in your agent and it will install itself to the right directory — no path setup needed:"}
      </p>
      <CodeBlock text={install} />

      <Subhead lang={lang} en="trigger examples" zh="触发示例" />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 6,
        }}
      >
        {[
          lang === "zh" ? "今天 AI 圈有什么新东西" : "what's new in AI today",
          lang === "zh" ? "看一下今天的 AI 日报" : "show me today's AI column",
          lang === "zh" ? "最近 OpenAI 有什么发布" : "what did OpenAI ship recently",
          lang === "zh" ? "看下精选条目" : "show featured items",
          lang === "zh" ? "最近 Anthropic 有什么发布" : "what did Anthropic ship recently",
          lang === "zh" ? "AI 模型发布列表" : "list of AI model releases",
          lang === "zh" ? "最近 3 天 AI 行业动态" : "AI industry news, last 3 days",
          lang === "zh" ? "AX Radar 都从哪些源拉" : "which sources does AX Radar cover",
        ].map((t) => (
          <div
            key={t}
            style={{
              fontSize: 12,
              color: "var(--fg-2)",
              fontFamily:
                lang === "zh"
                  ? "var(--font-sans-cjk)"
                  : "var(--font-mono)",
              padding: "6px 10px",
              background: "rgba(255,255,255,0.02)",
              border: "1px solid var(--border-1)",
              borderRadius: 3,
            }}
          >
            “{t}”
          </div>
        ))}
      </div>

      <Subhead
        lang={lang}
        en="intent → endpoint routing"
        zh="Skill 内部能做的事"
      />
      <p style={subBodyStyle(lang)}>
        {lang === "zh"
          ? "Skill 根据用户意图智能分流端点。默认走精选 + view=today;只有用户明确说「日报」才走 daily,明确说「全部」才走 mode=all。"
          : "Skill routes intent to the right endpoint. Default: featured + today's view. Only goes to /daily when the user explicitly says 'daily column', or tier=all when they say 'all' or 'everything'."}
      </p>
      <DataTable
        head={
          lang === "zh"
            ? ["用户意图", "调用的端点"]
            : ["User intent", "Endpoint called"]
        }
        rows={[
          [
            lang === "zh"
              ? "默认(宽问题)"
              : 'default ("what\'s new")',
            "GET /api/public/feed?tier=featured&view=today",
          ],
          [
            lang === "zh" ? "明确说「日报」" : 'explicit "daily column"',
            "GET /api/public/daily 或 /daily/{date}",
          ],
          [
            lang === "zh" ? "AX 严选 / 精选源" : 'curated only',
            "GET /api/public/feed?curated_only=true",
          ],
          [
            lang === "zh" ? "全部 / 完整" : 'all / complete',
            "GET /api/public/feed?tier=all",
          ],
          [
            lang === "zh" ? "关键词搜索" : 'keyword search',
            "GET /api/public/search?q=...",
          ],
          [
            lang === "zh" ? "语义检索 (概念相关)" : 'semantic search',
            "GET /api/public/search?q=...&mode=semantic",
          ],
          [
            lang === "zh" ? "多源事件覆盖" : 'multi-source event coverage',
            "GET /api/public/events/{cluster_id}/members",
          ],
          [
            lang === "zh" ? "单条全文" : 'single item full detail',
            "GET /api/public/items/{id}",
          ],
        ]}
      />

      <p style={{ ...subBodyStyle(lang), marginTop: 16 }}>
        {lang === "zh" ? "完整 Skill 文档: " : "Full skill body: "}
        <a href="/skill.md" style={linkStyle}>
          /skill.md
        </a>
      </p>
    </PaneShell>
  );
}

/* ============================================================================
 * Pane 2: RSS
 * ========================================================================= */

function RssPane({ lang }: { lang: Lang }) {
  const feeds: Array<{
    title: string;
    url: string;
    desc: string;
    badge?: string;
  }> = [
    {
      title: lang === "zh" ? "AX Radar — 热点聚合" : "AX Radar — hot today",
      url: `${SITE}/api/rss/today.xml`,
      desc:
        lang === "zh"
          ? "今日 AI 行业要闻,自动聚合多源覆盖。"
          : "Today's AI news and multi-source events.",
      badge: lang === "zh" ? "推荐订阅" : "recommended",
    },
    {
      title: lang === "zh" ? "AX Radar — AX 严选" : "AX Radar — curated",
      url: `${SITE}/api/rss/curated.xml`,
      desc:
        lang === "zh"
          ? "操作员手选信源:鸭哥/grapeot、AI 群聊日报、阮一峰等。"
          : "Operator-curated publishers — Grapeot, AI 群聊日报, Ruanyifeng, etc.",
    },
    {
      title:
        lang === "zh" ? "AX Radar — 每日 AI 日报" : "AX Radar — daily column",
      url: `${SITE}/api/rss/daily.xml`,
      desc:
        lang === "zh"
          ? "每日 9pm PT 一篇 AI 日报,像朋友分享一样讲清楚当天重点。"
          : "Daily 9pm PT — a clear editorial column that reads like sharing the day's signal with a friend.",
    },
    {
      title:
        lang === "zh"
          ? "AX Radar — 双语主 feed (zh)"
          : "AX Radar — main feed (zh)",
      url: `${SITE}/api/feed/zh/rss.xml`,
      desc:
        lang === "zh"
          ? "featured + p1 合集,带 锐评 + content:encoded 全文。"
          : "Featured + p1 union with editor commentary in content:encoded.",
    },
    {
      title:
        lang === "zh"
          ? "AX Radar — 双语主 feed (en)"
          : "AX Radar — main feed (en)",
      url: `${SITE}/api/feed/en/rss.xml`,
      desc:
        lang === "zh"
          ? "英文版主 feed。"
          : "English main feed (English titles + summaries).",
    },
  ];

  return (
    <PaneShell
      overline={
        lang === "zh"
          ? "RSS · 任意 READER 订阅"
          : "RSS · ANY READER SUBSCRIBES"
      }
      heading={
        lang === "zh" ? "五条 feed,按需订阅" : "Five feeds, pick what you need"
      }
      lang={lang}
    >
      <p style={bodyStyle(lang)}>
        {lang === "zh" ? (
          <>
            所有主流 RSS reader (Feedly / Inoreader / NetNewsWire / Reeder /
            Reader.app / Tiny Tiny RSS …) 都能直接订阅。复制下面的 URL 粘到
            reader 里即可。
          </>
        ) : (
          <>
            Works with every mainstream RSS reader (Feedly / Inoreader /
            NetNewsWire / Reeder / Reader.app / Tiny Tiny RSS …). Copy the URL
            into your reader.
          </>
        )}
      </p>

      <Subhead lang={lang} en="feeds" zh="可订阅的 feed" />
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {feeds.map((f) => (
          <div
            key={f.url}
            style={{
              border: "1px solid var(--border-1)",
              borderRadius: 4,
              padding: "12px 14px",
              background: "rgba(255,255,255,0.01)",
              position: "relative",
            }}
          >
            {f.badge && (
              <span
                style={{
                  position: "absolute",
                  top: -8,
                  right: 12,
                  background: "var(--bg-1)",
                  border: "1px solid var(--accent-green)",
                  color: "var(--accent-green)",
                  fontSize: 10,
                  padding: "1px 6px",
                  borderRadius: 2,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                }}
              >
                {f.badge}
              </span>
            )}
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--fg-0)",
                fontFamily:
                  lang === "zh" ? "var(--font-sans-cjk)" : "var(--font-mono)",
                marginBottom: 4,
              }}
            >
              {f.title}
            </div>
            <div
              style={{
                fontSize: 12,
                color: "var(--fg-3)",
                fontFamily:
                  lang === "zh" ? "var(--font-sans-cjk)" : "var(--font-mono)",
                marginBottom: 8,
              }}
            >
              {f.desc}
            </div>
            <CodeBlock text={f.url} compact />
          </div>
        ))}
      </div>

      <Subhead
        lang={lang}
        en="technical notes"
        zh="技术规范 (给 reader 实现者 / Agent)"
      />
      <ul style={listStyle(lang)}>
        <li>
          {lang === "zh"
            ? "格式: RSS 2.0,所有 reader 都吃"
            : "Format: RSS 2.0 — universal support"}
        </li>
        <li>
          {lang === "zh"
            ? "编码: UTF-8,Content-Type: application/rss+xml"
            : "Encoding: UTF-8, Content-Type: application/rss+xml"}
        </li>
        <li>
          {lang === "zh"
            ? "缓存: 响应带 Cache-Control / s-maxage=600 / stale-while-revalidate=3600"
            : "Cache: Cache-Control: public, s-maxage=600, stale-while-revalidate=3600"}
        </li>
        <li>
          {lang === "zh"
            ? "Per-IP 限流: 60 req/h (RSS reader 正常轮询足够)"
            : "Per-IP limit: 60 req/h (more than enough for any reader's default polling)"}
        </li>
        <li>
          {lang === "zh"
            ? "推荐轮询频率: ≥ 30 分钟"
            : "Recommended poll: ≥ 30 minutes"}
        </li>
      </ul>
    </PaneShell>
  );
}

/* ============================================================================
 * Pane 3: REST API
 * ========================================================================= */

function ApiPane({ lang }: { lang: Lang }) {
  return (
    <PaneShell
      overline={
        lang === "zh"
          ? "REST API · 任意语言"
          : "REST API · ANY LANGUAGE"
      }
      heading={
        lang === "zh"
          ? "完整 OpenAPI 3.1,匿名只读"
          : "Full OpenAPI 3.1, anonymous read-only"
      }
      lang={lang}
    >
      <p style={bodyStyle(lang)}>
        {lang === "zh" ? (
          <>
            无需 token。响应只暴露用户在浏览器能看到的字段(LLM
            内部 reasoning / 单轴 HKR 解释一律剥离)。建议优先读{" "}
            <a href="/openapi.yaml" style={linkStyle}>
              /openapi.yaml
            </a>{" "}
            拿严格 schema,本页是人类可读的镜像。
          </>
        ) : (
          <>
            No token required. Responses expose only user-visible fields (LLM
            internal reasoning and per-axis HKR explanations are stripped).
            Authoritative schema:{" "}
            <a href="/openapi.yaml" style={linkStyle}>
              /openapi.yaml
            </a>
            .
          </>
        )}
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        <LinkButton href="/openapi.yaml">
          {lang === "zh" ? "查看完整 OpenAPI YAML" : "View OpenAPI YAML"}
        </LinkButton>
        <LinkButton href="/skill.md">
          {lang === "zh" ? "查看 SKILL.md" : "View SKILL.md"}
        </LinkButton>
      </div>

      <Subhead lang={lang} en="endpoint summary" zh="端点速览" />
      <DataTable
        head={
          lang === "zh"
            ? ["端点", "用途"]
            : ["Endpoint", "Purpose"]
        }
        rows={[
          [
            "GET /api/public/feed",
            lang === "zh"
              ? "主 feed(支持 tier / view / source / 日期 / 限流 等过滤)"
              : "Main feed (tier / view / source / date filters)",
          ],
          [
            "GET /api/public/items/{id}",
            lang === "zh"
              ? "单条全量(双语 + body_md + event 块)"
              : "Single item (bilingual + body_md + event block)",
          ],
          [
            "GET /api/public/search",
            lang === "zh"
              ? "lexical 子串 / semantic 向量检索"
              : "Lexical substring / semantic vector search",
          ],
          [
            "GET /api/public/events/{cluster_id}/members",
            lang === "zh"
              ? "多源事件的所有覆盖源"
              : "All members of a multi-source event",
          ],
          [
            "GET /api/public/sources",
            lang === "zh"
              ? "精选信源目录 + 实时健康"
              : "Monitored source catalog + live health",
          ],
          [
            "GET /api/public/daily",
            lang === "zh"
              ? "最新 AI 日报专栏"
              : "Latest daily AI column",
          ],
          [
            "GET /api/public/daily/{YYYY-MM-DD}",
            lang === "zh" ? "指定日期日报" : "Daily column by date",
          ],
          [
            "GET /api/public/dailies",
            lang === "zh"
              ? "日报归档列表(discovery)"
              : "Daily column index (discovery)",
          ],
        ]}
      />

      <Subhead lang={lang} en="curl examples" zh="curl 示例" />

      <ExampleBlock
        title={lang === "zh" ? "今日热点精选(默认)" : "Today's featured (default)"}
        code={`curl '${SITE}/api/public/feed?tier=featured&view=today&limit=20'`}
      />

      <ExampleBlock
        title={lang === "zh" ? "AX 严选" : "Curated only"}
        code={`curl '${SITE}/api/public/feed?curated_only=true&tier=all&limit=30'`}
      />

      <ExampleBlock
        title={lang === "zh" ? "关键词搜索" : "Keyword search"}
        code={`curl '${SITE}/api/public/search?q=OpenAI&limit=10'`}
      />

      <ExampleBlock
        title={lang === "zh" ? "今日 AI 日报" : "Today's daily column"}
        code={`curl '${SITE}/api/public/daily'`}
      />

      <Subhead
        lang={lang}
        en="ETag — cron pollers, save 99% of empty calls"
        zh="ETag · 给 cron 轮询者用 (干掉 99% 空查询)"
      />
      <p style={subBodyStyle(lang)}>
        {lang === "zh" ? (
          <>
            所有端点返回 <code style={codeInline}>weak ETag</code>。带{" "}
            <code style={codeInline}>If-None-Match</code> 重发,无新内容直接{" "}
            <code style={codeInline}>304</code>,空 body,客户端 return
            即可,服务器侧成本接近 0。
          </>
        ) : (
          <>
            All endpoints return a <code style={codeInline}>weak ETag</code>.
            Re-send with <code style={codeInline}>If-None-Match</code> — no new
            content returns <code style={codeInline}>304</code> with empty body;
            near-zero server cost.
          </>
        )}
      </p>

      <ExampleBlock
        title={lang === "zh" ? "200 + ETag,然后 304" : "200 + ETag, then 304"}
        code={`# First call: 200 + ETag
curl -D - '${SITE}/api/public/feed?tier=featured&view=today'
# Read 'etag: W/"public-feed-xxxxxxxxxxxxxxxx"' from response headers, then:

curl -H 'If-None-Match: W/"public-feed-xxxxxxxxxxxxxxxx"' \\
     -D - '${SITE}/api/public/feed?tier=featured&view=today'
# → 304 Not Modified, empty body`}
      />

      <Subhead
        lang={lang}
        en="rate limits"
        zh="限流 (per-IP)"
      />
      <DataTable
        head={
          lang === "zh" ? ["端点家族", "限制"] : ["Endpoint family", "Limit"]
        }
        rows={[
          [
            "/feed, /items/{id}, /events/{id}/members",
            "600 req/min",
          ],
          [
            "/search (LLM cost)",
            "120 req/min",
          ],
          [
            "/daily{,/[date]}, /dailies, /sources",
            "300 req/min",
          ],
        ]}
      />

      <Subhead lang={lang} en="gotchas" zh="易错点" />
      <ul style={listStyle(lang)}>
        <li>
          {lang === "zh"
            ? "publisher 是显示名,不是 id — 过滤用 source_id (e.g. 'dwarkesh-yt')"
            : "publisher is a display name, not an id — filter by source_id (e.g. 'dwarkesh-yt')"}
        </li>
        <li>
          {lang === "zh"
            ? "date_from / date_to 必须是 ISO 8601 (例: 2026-05-01T00:00:00Z)"
            : "date_from / date_to must be ISO 8601 (e.g. 2026-05-01T00:00:00Z)"}
        </li>
        <li>
          {lang === "zh"
            ? "limit 上限 100,要 500 条得翻 5 页"
            : "limit cap is 100 — to get 500 results, paginate"}
        </li>
        <li>
          {lang === "zh"
            ? "cluster_id 来自 feed 响应,不要瞎构造"
            : "cluster_id comes from a feed response — don't construct it"}
        </li>
        <li>
          {lang === "zh"
            ? "可空字段: hkr, cluster_id, coverage, canonical_title, summary, body_md"
            : "Nullable fields: hkr, cluster_id, coverage, canonical_title, summary, body_md"}
        </li>
        <li>
          {lang === "zh"
            ? "属性命名 snake_case (cluster_id, published_at) ;canonical_title 跟 locale 走"
            : "Properties are snake_case (cluster_id, published_at); canonical_title respects locale"}
        </li>
      </ul>
    </PaneShell>
  );
}

/* ============================================================================
 * Caveats — shown across all panes (matches AI HOT's footer pattern)
 * ========================================================================= */

function Caveats({ lang }: { lang: Lang }) {
  return (
    <div
      style={{
        marginTop: 36,
        padding: "16px 18px",
        background: "rgba(255,255,255,0.015)",
        border: "1px solid var(--border-1)",
        borderRadius: 4,
        fontSize: 12,
        color: "var(--fg-3)",
        fontFamily:
          lang === "zh" ? "var(--font-sans-cjk)" : "var(--font-mono)",
        lineHeight: 1.7,
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: "var(--fg-2)",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          marginBottom: 8,
        }}
      >
        {lang === "zh"
          ? "使用须知 · 原文为准 / 合理使用 / 测试版"
          : "use responsibly · attribute / fair use / beta"}
      </div>
      <ul style={{ ...listStyle(lang), color: "var(--fg-3)", marginTop: 0 }}>
        <li>
          {lang === "zh" ? (
            <>
              <strong>原文为准</strong> —
              摘要和锐评由 LLM 生成,引用前请用 <code style={codeInline}>url</code>{" "}
              字段回原文核对。
            </>
          ) : (
            <>
              <strong>Cite the original</strong> — summaries and editor takes
              are LLM-generated; verify against the <code style={codeInline}>url</code>{" "}
              before quoting.
            </>
          )}
        </li>
        <li>
          {lang === "zh"
            ? "合理使用 — 默认限流对正常会话 + RSS reader 默认轮询足够,不要并发硬刷"
            : "Fair use — default limits cover normal use; don't hammer in parallel."}
        </li>
        <li>
          {lang === "zh" ? (
            <>
              <strong>测试版</strong> — Skill / RSS / REST API
              三轨均处于测试阶段。服务器扛不住或滥用可能临时下线、调整接口、加访问限制。生产业务请勿强依赖。
            </>
          ) : (
            <>
              <strong>Beta</strong> — all three tracks (Skill / RSS / REST API)
              are in beta. We may rate-limit, change shapes, or pause endpoints
              if abuse hits. Don&apos;t hard-depend in production.
            </>
          )}
        </li>
      </ul>
    </div>
  );
}

/* ============================================================================
 * Atoms: PaneShell, Subhead, CodeBlock, DataTable, ExampleBlock, LinkButton
 * ========================================================================= */

function PaneShell({
  overline,
  heading,
  lang,
  children,
}: {
  overline: string;
  heading: string;
  lang: Lang;
  children: ReactNode;
}) {
  return (
    <section>
      <div
        style={{
          fontSize: 10,
          color: "var(--accent-green)",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          marginBottom: 8,
          fontFamily: "var(--font-mono)",
        }}
      >
        {overline}
      </div>
      <h2
        style={{
          fontSize: 24,
          fontWeight: 600,
          color: "var(--fg-0)",
          marginBottom: 14,
          letterSpacing: "-0.01em",
          fontFamily:
            lang === "zh" ? "var(--font-sans-cjk)" : "var(--font-mono)",
        }}
      >
        {heading}
      </h2>
      {children}
    </section>
  );
}

function Subhead({
  en,
  zh,
  lang,
}: {
  en: string;
  zh: string;
  lang: Lang;
}) {
  return (
    <h3
      style={{
        fontSize: 13,
        fontWeight: 600,
        color: "var(--fg-1)",
        marginTop: 26,
        marginBottom: 8,
        letterSpacing: "0.02em",
        fontFamily:
          lang === "zh" ? "var(--font-sans-cjk)" : "var(--font-mono)",
      }}
    >
      {lang === "zh" ? zh : en}
    </h3>
  );
}

function CodeBlock({ text, compact }: { text: string; compact?: boolean }) {
  return (
    <div
      style={{
        position: "relative",
        background: "var(--bg-0, #0d1117)",
        border: "1px solid var(--border-1)",
        borderRadius: 3,
        padding: compact ? "8px 10px" : "10px 12px",
        paddingRight: 56,
        fontFamily: "var(--font-mono)",
        fontSize: compact ? 11.5 : 12,
        color: "var(--fg-1)",
        overflowX: "auto",
        whiteSpace: "pre",
      }}
    >
      <code>{text}</code>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard
            .writeText(text)
            .then(() => toast.success("copied"))
            .catch(() => toast.error("copy failed"));
        }}
        style={{
          position: "absolute",
          top: 6,
          right: 6,
          background: "rgba(255,255,255,0.04)",
          border: "1px solid var(--border-1)",
          color: "var(--fg-3)",
          fontSize: 10,
          padding: "2px 6px",
          borderRadius: 2,
          cursor: "pointer",
          fontFamily: "var(--font-mono)",
          letterSpacing: "0.04em",
        }}
        aria-label="copy"
      >
        copy
      </button>
    </div>
  );
}

function ExampleBlock({
  title,
  code,
}: {
  title: string;
  code: string;
}) {
  return (
    <div style={{ marginTop: 14 }}>
      <div
        style={{
          fontSize: 11,
          color: "var(--fg-3)",
          marginBottom: 6,
          fontFamily: "var(--font-mono)",
          letterSpacing: "0.02em",
        }}
      >
        # {title}
      </div>
      <CodeBlock text={code} />
    </div>
  );
}

function DataTable({
  head,
  rows,
}: {
  head: string[];
  rows: Array<[string, string]>;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--border-1)",
        borderRadius: 4,
        overflow: "hidden",
        marginTop: 4,
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(220px, 1fr) 1.4fr",
          background: "rgba(255,255,255,0.02)",
          padding: "8px 12px",
          fontSize: 11,
          color: "var(--fg-3)",
          fontFamily: "var(--font-mono)",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          borderBottom: "1px solid var(--border-1)",
        }}
      >
        <div>{head[0]}</div>
        <div>{head[1]}</div>
      </div>
      {rows.map(([a, b], idx) => (
        <div
          key={a + idx}
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(220px, 1fr) 1.4fr",
            padding: "10px 12px",
            fontSize: 12,
            color: "var(--fg-1)",
            borderBottom:
              idx === rows.length - 1
                ? "none"
                : "1px solid var(--border-1)",
            fontFamily: "var(--font-mono)",
            gap: 12,
            lineHeight: 1.5,
          }}
        >
          <div style={{ color: "var(--fg-2)", wordBreak: "break-word" }}>
            {a}
          </div>
          <div style={{ color: "var(--fg-1)", wordBreak: "break-all" }}>
            {b}
          </div>
        </div>
      ))}
    </div>
  );
}

function LinkButton({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 12px",
        background: "rgba(255,255,255,0.02)",
        border: "1px solid var(--border-1)",
        borderRadius: 3,
        color: "var(--accent-green)",
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        textDecoration: "none",
      }}
    >
      {children}
      <span style={{ fontSize: 10, opacity: 0.6 }}>→</span>
    </a>
  );
}

/* ============================================================================
 * Styles
 * ========================================================================= */

function leadStyle(lang: Lang): React.CSSProperties {
  return {
    color: "var(--fg-2)",
    fontSize: 14,
    lineHeight: 1.7,
    maxWidth: 720,
    marginBottom: 8,
    fontFamily:
      lang === "zh" ? "var(--font-sans-cjk)" : "var(--font-mono)",
  };
}

function bodyStyle(lang: Lang): React.CSSProperties {
  return {
    color: "var(--fg-2)",
    fontSize: 13,
    lineHeight: 1.7,
    maxWidth: 720,
    marginBottom: 4,
    fontFamily:
      lang === "zh" ? "var(--font-sans-cjk)" : "var(--font-mono)",
  };
}

function subBodyStyle(lang: Lang): React.CSSProperties {
  return {
    color: "var(--fg-3)",
    fontSize: 12,
    lineHeight: 1.7,
    maxWidth: 720,
    marginBottom: 8,
    marginTop: 0,
    fontFamily:
      lang === "zh" ? "var(--font-sans-cjk)" : "var(--font-mono)",
  };
}

function listStyle(lang: Lang): React.CSSProperties {
  return {
    color: "var(--fg-2)",
    fontSize: 12,
    lineHeight: 1.8,
    paddingLeft: 18,
    marginTop: 4,
    maxWidth: 720,
    fontFamily:
      lang === "zh" ? "var(--font-sans-cjk)" : "var(--font-mono)",
  };
}

const codeInline: React.CSSProperties = {
  background: "var(--bg-2)",
  padding: "1px 5px",
  borderRadius: 2,
  fontSize: 11,
  color: "var(--fg-1)",
  fontFamily: "var(--font-mono)",
};

const linkStyle: React.CSSProperties = {
  color: "var(--accent-green)",
  textDecoration: "underline",
  textUnderlineOffset: 2,
};
