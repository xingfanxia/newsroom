/**
 * GET /skill.md — Public, installable SKILL.md (SKILL.md standard format).
 *
 * Any agent (Claude Code / Codex CLI / Cursor / Gemini CLI / GitHub Copilot /
 * OpenCode / Cline / Windsurf …) can install this by URL:
 *
 *   帮我安装这个 skill: <canonical site URL>/skill.md
 *
 * The agent fetches this file, parses the frontmatter + body, and saves it
 * under its skills directory. From then on the agent uses the intent→endpoint
 * routing table to call the right /api/public/* endpoint based on the user's
 * question.
 */
import {
  APP_LOCALES,
  FEED_VIEWS,
  ITEM_TIERS,
  SEARCH_MODES,
  SOURCE_GROUPS,
  SOURCE_KINDS,
  VISIBLE_ITEM_TIERS,
} from "@/lib/types";
import {
  PUBLIC_RATE_LIMIT_DOC_GROUPS,
  publicRateLimitLabel,
} from "@/lib/api/public-endpoint-config";
import { PUBLIC_SITE_URL, publicUrl } from "@/lib/site";

function markdownCodeUnion(values: readonly string[]): string {
  return values.map((value) => `\`${value}\``).join(" | ");
}

function compactUnion(values: readonly (string | null)[]): string {
  return values.map((value) => (value === null ? "null" : value)).join("|");
}

const APP_LOCALE_OPTIONS = markdownCodeUnion(APP_LOCALES);
const FEED_VIEW_OPTIONS = markdownCodeUnion(FEED_VIEWS);
const ITEM_TIER_RESPONSE_OPTIONS = compactUnion(ITEM_TIERS);
const SEARCH_MODE_OPTIONS = markdownCodeUnion(SEARCH_MODES);
const SOURCE_GROUP_OPTIONS = markdownCodeUnion(SOURCE_GROUPS);
const SOURCE_GROUP_RESPONSE_OPTIONS = compactUnion([...SOURCE_GROUPS, null]);
const SOURCE_KIND_OPTIONS = markdownCodeUnion(SOURCE_KINDS);
const SOURCE_KIND_RESPONSE_OPTIONS = compactUnion(SOURCE_KINDS);
const VISIBLE_ITEM_TIER_OPTIONS = markdownCodeUnion(VISIBLE_ITEM_TIERS);
const RATE_LIMIT_ROWS = PUBLIC_RATE_LIMIT_DOC_GROUPS.map(
  (group) =>
    `| ${group.skillEndpoints.join(" ")} | ${publicRateLimitLabel(group.keys[0])} |`,
).join("\n");
const SEARCH_RATE_LIMIT_LABEL = publicRateLimitLabel("search");

const SKILL_MARKDOWN = `---
name: ax-radar
description: 用最自然的中文 / 英文一句话拿到 AX Radar (${PUBLIC_SITE_URL}) 的精选 AI 动态、AX 严选、每日 AI 日报、多源事件覆盖。匿名免费,无需 token,无需配 MCP server。
triggers:
  - 今天 AI 圈
  - AI 日报
  - 看下精选条目
  - 最近 OpenAI 发布
  - 这一周 AI 圈
  - what's new in AI today
  - AX Radar
license: MIT
homepage: ${publicUrl("/zh/agents")}
api: ${publicUrl("/openapi.yaml")}
---

# AX Radar — Skill

把 AX Radar 的精选 AI 信号、AX 严选、每日 AI 日报接进任意 Agent。**匿名免费**——HTTP GET 就能拿数据,不需要 API Key、不需要配 MCP server。

> Bring AX Radar's curated AI signal, hand-picked editor stream, and daily AI column into any agent. **Free + anonymous** — plain HTTP GET, no API key, no MCP setup.

## 用户意图 → 调用端点 / Intent → Endpoint

Skill 根据用户提问关键词智能分流。默认走 **精选 + view=today**；只有用户明确说"日报"才走 \`/daily\`,明确说"全部"才走 \`tier=all\`。

| 用户意图 / Intent | 调用端点 / Endpoint |
|---|---|
| 默认 / 宽问题 ("今天 AI 圈","what's new today") | \`GET /api/public/feed?tier=featured&view=today\` |
| 明确说"日报" / "daily column" | \`GET /api/public/daily\` |
| 指定日期日报 ("昨天的日报") | \`GET /api/public/daily/{YYYY-MM-DD}\` |
| 日报归档 / discovery ("哪些日期有日报") | \`GET /api/public/dailies?take=30\` |
| "AX 严选 / 严选" / "curated only" | \`GET /api/public/feed?curated_only=true&tier=all\` |
| "全部 / 完整 / all" | \`GET /api/public/feed?tier=all\` |
| "最近 N 天" 时间窗 | \`GET /api/public/feed?date_from={ISO}\` |
| 关键词搜索 ("OpenAI 最近发的","Anthropic news") | \`GET /api/public/search?q={keyword}\` |
| 语义检索 ("agentic coding 相关的","semantic search") | \`GET /api/public/search?q={query}&mode=semantic\` |
| 多源事件全部覆盖 | \`GET /api/public/events/{cluster_id}/members\` |
| 单条全文 (含 YT transcript + 编辑锐评) | \`GET /api/public/items/{id}\` |
| 信源目录 ("AX Radar 覆盖了哪些源") | \`GET /api/public/sources\` |

## 触发示例 / Trigger Examples

- "今天 AI 圈有什么" → feed (default)
- "看一下今天的 AI 日报" → /daily
- "看下精选条目" → feed (default)
- "最近 OpenAI 有什么发布" → /search?q=OpenAI
- "AI 模型发布列表" → feed?include_source_tags=ai-model (or filter client-side)
- "找一下 autonomous coding agent 相关的" → /search?q=...&mode=semantic
- "AX Radar 都从哪些源拉" → /sources

## 输出模板 / Output Template

拉到数据后,**压缩到 ≤500 字**给用户,不要原样转发整篇日报或全 50 条 feed。建议格式:

\`\`\`
## AX Radar · {date}
{N} 条精选,横跨 {M} 个源。

1. **{title}** ({publisher}) — {一句话点评 / 单 source 的话用编辑 note}
2. ...

想看完整长篇日报: ${publicUrl("/zh/daily")}
\`\`\`

## 鉴权 / Auth

**没有鉴权**——所有 \`/api/public/*\` 都是匿名访问。

## 限流 / Rate Limit (per-IP)

| 端点家族 / Family | 限制 / Limit |
|---|---|
${RATE_LIMIT_ROWS}

超限返回 \`429\` + \`Retry-After\` (秒)。

## ETag / 缓存

所有端点返回 **weak ETag** (\`W/"<family>-<hash16>"\`)。**轮询场景务必带 \`If-None-Match\`**——无新内容返回 \`304\`,空 body,几乎 0 成本:

\`\`\`bash
# 第一次: 200 + ETag
curl -D - '${publicUrl("/api/public/feed?tier=featured&view=today")}'

# 第二次带回 ETag: 304 (空 body)
curl -H 'If-None-Match: W/"public-feed-xxxxxxxxxxxxxxxx"' \\
     -D - '${publicUrl("/api/public/feed?tier=featured&view=today")}'
\`\`\`

## 翻页 / Pagination

\`/api/public/feed\` 和 \`/api/public/search\` 用 \`limit\` + \`offset\` 翻页 (limit ≤ 100, default 40)。\`/api/public/dailies\` 用 \`take\` (≤ 180, default 30)。

## 关键 query 参数

\`/api/public/feed\` 完整参数:

- \`tier\` = ${VISIBLE_ITEM_TIER_OPTIONS}, default \`featured\`
- \`view\` = ${FEED_VIEW_OPTIONS}, default \`archive\`
- \`hot_window_hours\` = 1..168, default 24 (only used for view=today)
- \`date\` / \`date_from\` / \`date_to\` = filter by published_at
- \`source_id\` = exact source id (e.g. \`dwarkesh-yt\`)
- \`source_group\` = ${SOURCE_GROUP_OPTIONS}
- \`source_kind\` = ${SOURCE_KIND_OPTIONS}
- \`curated_only\` = true | false (AX 严选 tab)
- \`include_source_tags\` / \`exclude_source_tags\` = comma list
- \`limit\` = 1..100, default 40
- \`offset\` = ≥0, default 0
- \`locale\` = ${APP_LOCALE_OPTIONS}, default \`en\` (controls which language's title/summary returns)

\`/api/public/search\` 额外参数:

- \`mode\` = ${SEARCH_MODE_OPTIONS}, default \`lexical\`

## 响应 shape 关键不变量

每个 \`/feed\` item:

\`\`\`json
{
  "id": "string",
  "title": "string",
  "summary": "string",
  "publisher": "string",
  "source_id": "string",
  "source_group": "${SOURCE_GROUP_RESPONSE_OPTIONS}",
  "source_kind": "${SOURCE_KIND_RESPONSE_OPTIONS}",
  "tier": "${ITEM_TIER_RESPONSE_OPTIONS}",
  "importance": 0,
  "hkr": { "h": false, "k": false, "r": false } | null,
  "tags": ["string"],
  "url": "string",
  "published_at": "ISO-8601",
  "has_commentary": false,
  "cluster_id": 1 | null,
  "coverage": 2 | null,
  "canonical_title": "string|null"
}
\`\`\`

**注意可空字段**: \`hkr\`, \`source_group\`, \`cluster_id\`, \`coverage\`, \`canonical_title\` 可能为 null。\`coverage > 1\` 时这是个多源 event,可用 \`cluster_id\` 调 \`/events/{id}/members\` 看所有覆盖源。

## 易错点 (按出错频率排序)

1. **不要并发猛拉** — 端点有限流,翻页用串行 + 自然间隔
2. **\`date_from\` / \`date_to\` 必须是 ISO 8601** — 用 \`2026-05-01T00:00:00Z\`,不是 unix 时间戳
3. **\`limit\` 上限 100** — 想要 500 条要翻 5 页,不要 \`?limit=500\` (返回 400)
4. **拉日报别在 narrative_md 里搜关键词** — 那是长文,语义关键词用 \`/search?mode=semantic\`
5. **publisher 是显示名,不是 id** — 过滤用 \`source_id\` (e.g. \`dwarkesh-yt\`),不是 \`?publisher=Dwarkesh\`
6. **cluster_id 来自 feed 响应** — 不要瞎构造,只用 feed 给的值
7. **\`mode=semantic\` 有 LLM 成本** — 限流更严 (${SEARCH_RATE_LIMIT_LABEL}),不要无脑全切语义模式

## 使用须知 / Caveats

- **原文为准**: 摘要 + 编辑锐评由 LLM 生成,引用前用 \`url\` 字段回原文核对
- **测试版**: \`/api/public/*\` 三轨 (RSS / REST API / Skill) 都处于测试阶段,服务器扛不住或滥用可能会临时下线、调整接口、加访问限制。**生产业务请勿强依赖。**
- **反馈**: ${publicUrl("/zh/agents")}

## 完整 OpenAPI

\`${publicUrl("/openapi.yaml")}\` — 含完整 schema、所有错误响应、所有参数边界。
`;

export const dynamic = "force-static";

export async function GET(): Promise<Response> {
  return new Response(SKILL_MARKDOWN, {
    status: 200,
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400",
      "access-control-allow-origin": "*",
    },
  });
}
