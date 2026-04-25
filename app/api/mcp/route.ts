/**
 * MCP (Model Context Protocol) server — Bearer-gated, stateless, Streamable
 * HTTP. This is how Claude Desktop / Cursor / claude-code auto-discover the
 * AX Radar as a tool source.
 *
 * Transport:
 *   - Single HTTP endpoint at /api/mcp (POST for requests, GET for SSE stream,
 *     DELETE for session close)
 *   - Stateless mode (no session storage) because Vercel Fluid Compute reuses
 *     instances across concurrent requests but not across cold starts; giving
 *     each request its own McpServer is cheaper than juggling session state
 *     across invocations
 *   - JSON response mode (enableJsonResponse) because we don't need live
 *     tool streaming — all tools return quickly, no long-running ops
 *
 * Auth:
 *   Bearer token in `Authorization: Bearer <token>` (same tokens as /api/v1).
 *   MCP clients put the header in their config; the operator pastes the
 *   token minted via `scripts/ops/mint-api-token.ts mint <label>`.
 *
 * Tools registered — see the `registerTool` calls below. Each is a thin
 * adapter that calls the same library functions the /api/v1 routes use,
 * so the two surfaces can never drift.
 *
 * Resources registered:
 *   ax-radar://today           — today's curated feed as markdown
 *   ax-radar://item/{id}       — one item's full detail as markdown
 *
 * Configure in claude_desktop_config.json:
 *   {
 *     "mcpServers": {
 *       "ax-radar": {
 *         "url": "https://<your-domain>/api/mcp",
 *         "headers": { "Authorization": "Bearer <token>" }
 *       }
 *     }
 *   }
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { requireApiToken } from "@/lib/auth/api-token";
import {
  countFeaturedStories,
  getFeaturedStories,
  getEventMembers,
  type FeedQuery,
} from "@/lib/items/live";
import { semanticSearch } from "@/lib/items/semantic-search";
import { getItemDetail } from "@/lib/items/detail";
import { applyFeedbackToggle } from "@/lib/feedback/toggle";
import { listCollections } from "@/lib/items/collections";
import { totalsByWindow } from "@/lib/llm/stats";
import { db } from "@/db/client";
import { feedback, sources, sourceHealth } from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth/session";

type ToolOutput = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

function text(payload: unknown): ToolOutput {
  return {
    content: [
      {
        type: "text",
        text:
          typeof payload === "string"
            ? payload
            : JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function error(message: string): ToolOutput {
  return {
    content: [{ type: "text", text: `error: ${message}` }],
    isError: true,
  };
}

function buildServer(user: SessionUser): McpServer {
  const server = new McpServer({
    name: "ax-radar",
    version: "1.0.0",
  });

  server.registerTool(
    "ax_radar_feed",
    {
      title: "Browse the AX Radar feed",
      description:
        "Return curated items from the AX Radar timeline. Each row is a single editorial card: a singleton article OR a multi-source EVENT (multiple publishers covering the same real-world story merged into one card). When `coverage > 1` the row is an event — use ax_radar_event_members to see all the sources covering it. `view=today` is the importance-sorted hot feed (热点聚合) — what matters today, including events still developing. `view=archive` (default) is the chronological calendar timeline keyed on the lead's published_at. `tier=featured` is today's signal, `tier=all` spans everything non-excluded. Set `curated_only=true` for the operator-curated AX严选 stream (hand-picked publishers like 鸭哥/grapeot, 群聊日报). Use `exclude_source_tags='arxiv,paper'` to drop research-paper feeds from a news view, or `include_source_tags='arxiv,paper'` for the 论文 tab.",
      inputSchema: {
        tier: z.enum(["featured", "p1", "all"]).optional(),
        view: z.enum(["today", "archive"]).optional(),
        hot_window_hours: z.number().int().min(1).max(168).optional(),
        source_id: z.string().optional(),
        source_group: z.string().optional(),
        source_kind: z.string().optional(),
        curated_only: z.boolean().optional(),
        exclude_source_tags: z.array(z.string()).optional(),
        include_source_tags: z.array(z.string()).optional(),
        date: z.string().optional(),
        date_from: z.string().optional(),
        date_to: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional(),
        locale: z.enum(["zh", "en"]).optional(),
      },
    },
    async (args) => {
      const locale = args.locale ?? "en";
      const q: FeedQuery = {
        tier: args.tier ?? "featured",
        locale,
        limit: args.limit ?? 40,
        offset: args.offset ?? 0,
        sourceId: args.source_id,
        sourceGroup: args.source_group,
        sourceKind: args.source_kind,
        date: args.date,
        dateFrom: args.date_from,
        dateTo: args.date_to,
        includeSourceGroup: true,
        view: args.view ?? "archive",
        hotWindowHours: args.hot_window_hours,
        curatedOnly: args.curated_only,
        excludeSourceTags: args.exclude_source_tags,
        includeSourceTags: args.include_source_tags,
      };
      const [stories, total] = await Promise.all([
        getFeaturedStories(q),
        countFeaturedStories(q),
      ]);
      return text({
        items: stories.map((s) => {
          const isEvent = (s.coverage ?? 0) > 1 && s.clusterId != null;
          return {
            id: s.id,
            title: s.title,
            summary: s.summary,
            publisher: s.source.publisher,
            source_id: s.sourceId,
            source_group: s.source.groupCode ?? null,
            tier: s.tier,
            importance: s.importance,
            hkr: s.hkr ?? null,
            url: s.url,
            published_at: s.publishedAt,
            has_commentary: Boolean(s.editorNote || s.editorAnalysis),
            // Event aggregation — null for singletons.
            cluster_id: s.clusterId ?? null,
            coverage: s.coverage ?? null,
            canonical_title: isEvent
              ? (locale === "zh" ? s.canonicalTitleZh : s.canonicalTitleEn) ??
                null
              : null,
            first_seen_at: s.firstSeenAt ?? null,
            latest_member_at: s.latestMemberAt ?? null,
            still_developing: s.stillDeveloping ?? null,
          };
        }),
        total,
        limit: q.limit,
        offset: q.offset,
        view: q.view,
      });
    },
  );

  server.registerTool(
    "ax_radar_event_members",
    {
      title: "Fetch cross-source coverage for one event",
      description:
        "Given a cluster_id from ax_radar_feed (rows where coverage > 1 are multi-source events), return the full list of items that comprise the event — title, source, url, importance — ordered by importance DESC. Use this to drill into 'who else covered this story?' or to cite multiple primary sources when summarizing.",
      inputSchema: {
        cluster_id: z.number().int().positive(),
        locale: z.enum(["zh", "en"]).optional(),
      },
    },
    async ({ cluster_id, locale }) => {
      const members = await getEventMembers(cluster_id, locale ?? "en");
      return text({
        cluster_id,
        members: members.map((m) => ({
          source_id: m.sourceId,
          source_name: m.sourceName,
          title: m.title,
          url: m.url,
          published_at: m.publishedAt,
          importance: m.importance,
        })),
        total: members.length,
      });
    },
  );

  server.registerTool(
    "ax_radar_get_item",
    {
      title: "Read full detail for one item",
      description:
        "Fetch the full payload for a given item id: both-locale title/summary, editor note, multi-paragraph editor_analysis, LLM reasoning, HKR breakdown with per-axis rationale, full body_md (transcript for YT, article text for RSS). Use this after ax_radar_feed or ax_radar_search to go deep on a hit.",
      inputSchema: {
        id: z.number().int().positive(),
        locale: z.enum(["zh", "en"]).optional(),
      },
    },
    async ({ id, locale }) => {
      const detail = await getItemDetail(id, locale ?? "en");
      if (!detail) return error(`item ${id} not found or excluded`);
      return text({ story: detail.story, body_md: detail.bodyMd });
    },
  );

  server.registerTool(
    "ax_radar_search",
    {
      title: "Search the radar by keyword or concept",
      description:
        "Lexical mode (default) does case-insensitive substring match against title + summary. Semantic mode embeds your query and ranks items by pgvector cosine distance — better for conceptual queries where the exact phrase isn't in the text (e.g. 'autonomous coding agent' surfaces pieces about IDE automation). Semantic returns a `distance` field per hit (smaller = closer; ~-1 for near-identical vectors).",
      inputSchema: {
        q: z.string().min(1),
        mode: z.enum(["lexical", "semantic"]).optional(),
        source_id: z.string().optional(),
        source_group: z.string().optional(),
        source_kind: z.string().optional(),
        date_from: z.string().optional(),
        date_to: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
        locale: z.enum(["zh", "en"]).optional(),
      },
    },
    async (args) => {
      const mode = args.mode ?? "lexical";
      const limit = args.limit ?? 20;

      const locale = args.locale ?? "en";

      if (mode === "semantic") {
        const result = await semanticSearch(args.q, {
          locale,
          limit,
          sourceId: args.source_id,
          sourceGroup: args.source_group,
          sourceKind: args.source_kind,
          dateFrom: args.date_from,
          dateTo: args.date_to,
        });
        return text({
          mode: "semantic",
          q: args.q,
          items: result.items.map((s) => {
            const isEvent = (s.coverage ?? 0) > 1 && s.clusterId != null;
            return {
              id: s.id,
              title: s.title,
              summary: s.summary,
              publisher: s.source.publisher,
              source_id: s.sourceId,
              tier: s.tier,
              importance: s.importance,
              url: s.url,
              published_at: s.publishedAt,
              distance: s.distance,
              cluster_id: s.clusterId ?? null,
              coverage: s.coverage ?? null,
              canonical_title: isEvent
                ? (locale === "zh"
                    ? s.canonicalTitleZh
                    : s.canonicalTitleEn) ?? null
                : null,
            };
          }),
          total: result.total,
        });
      }

      const q: FeedQuery = {
        tier: "all",
        locale,
        limit,
        sourceId: args.source_id,
        sourceGroup: args.source_group,
        sourceKind: args.source_kind,
        dateFrom: args.date_from,
        dateTo: args.date_to,
        searchText: args.q,
        includeSourceGroup: true,
      };
      const stories = await getFeaturedStories(q);
      return text({
        mode: "lexical",
        q: args.q,
        items: stories.map((s) => {
          const isEvent = (s.coverage ?? 0) > 1 && s.clusterId != null;
          return {
            id: s.id,
            title: s.title,
            summary: s.summary,
            publisher: s.source.publisher,
            source_id: s.sourceId,
            tier: s.tier,
            importance: s.importance,
            url: s.url,
            published_at: s.publishedAt,
            cluster_id: s.clusterId ?? null,
            coverage: s.coverage ?? null,
            canonical_title: isEvent
              ? (locale === "zh"
                  ? s.canonicalTitleZh
                  : s.canonicalTitleEn) ?? null
              : null,
          };
        }),
        total: stories.length,
      });
    },
  );

  server.registerTool(
    "ax_radar_sources",
    {
      title: "List monitored sources + live health",
      description:
        "Return the 59-source catalog (podcasts, newsletters, vendor blogs, research feeds, X handles, ...) with current health: status, consecutive failures, last success, total items ingested. Useful for answering 'do we even watch X?' before phrasing a broader query.",
      inputSchema: {},
    },
    async () => {
      const rows = await db()
        .select({
          id: sources.id,
          nameEn: sources.nameEn,
          nameZh: sources.nameZh,
          kind: sources.kind,
          group: sources.group,
          cadence: sources.cadence,
          enabled: sources.enabled,
          status: sourceHealth.status,
          lastSuccessAt: sourceHealth.lastSuccessAt,
          consecutiveFailures: sourceHealth.consecutiveFailures,
          totalItemsCount: sourceHealth.totalItemsCount,
        })
        .from(sources)
        .leftJoin(sourceHealth, eq(sources.id, sourceHealth.sourceId))
        .orderBy(asc(sources.id));
      return text({
        sources: rows.map((r) => ({
          id: r.id,
          name_en: r.nameEn,
          name_zh: r.nameZh,
          kind: r.kind,
          group: r.group,
          cadence: r.cadence,
          enabled: r.enabled,
          status: r.status ?? "pending",
          last_success_at: r.lastSuccessAt?.toISOString() ?? null,
          consecutive_failures: r.consecutiveFailures ?? 0,
          total_items: r.totalItemsCount ?? 0,
        })),
        total: rows.length,
      });
    },
  );

  server.registerTool(
    "ax_radar_save",
    {
      title: "Save an item to the operator's collections",
      description:
        "Bookmark an item for the human to review later. Pass on=true to save, on=false to un-save. Optionally pin to a named collection via collection_id (use ax_radar_collections_list to find ids). Returns the authoritative save state.",
      inputSchema: {
        item_id: z.number().int().positive(),
        on: z.boolean(),
        collection_id: z.number().int().positive().optional(),
        note: z.string().max(500).optional(),
      },
    },
    async ({ item_id, on, collection_id, note }) => {
      try {
        const votes = await applyFeedbackToggle(user, {
          itemId: item_id,
          vote: "save",
          on,
          note,
        });
        if (on && collection_id !== undefined) {
          await db()
            .update(feedback)
            .set({ collectionId: collection_id })
            .where(
              and(
                eq(feedback.itemId, item_id),
                eq(feedback.userId, user.id),
                eq(feedback.vote, "save"),
              ),
            );
        }
        return text({
          item_id,
          saved: votes.save,
          collection_id: collection_id ?? null,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/foreign key|not present/i.test(msg)) {
          return error(`item ${item_id} not found`);
        }
        return error(msg);
      }
    },
  );

  server.registerTool(
    "ax_radar_collections_list",
    {
      title: "List saved-item collections",
      description:
        "Return the operator's named bookmark folders with running save counts. Pinned collections come first. Use before ax_radar_save with a collection_id to look up the right id.",
      inputSchema: {},
    },
    async () => {
      const collections = await listCollections(user.id);
      return text({ collections, total: collections.length });
    },
  );

  server.registerTool(
    "ax_radar_usage",
    {
      title: "Check LLM spend + token budget",
      description:
        "Return recent LLM cost + token usage for a time window. Useful for chatty agents to budget check before firing a batch. Fields: calls, cost_usd, input/output/reasoning tokens, plus per-task breakdown.",
      inputSchema: {
        window: z.enum(["today", "week", "month"]).optional(),
      },
    },
    async ({ window }) => {
      const w = window ?? "week";
      const totals = await totalsByWindow(w);
      return text({
        window: w,
        calls: totals.calls,
        cost_usd: totals.costUsd,
        input_tokens: totals.inputTokens,
        cached_input_tokens: totals.cachedInputTokens,
        output_tokens: totals.outputTokens,
        reasoning_tokens: totals.reasoningTokens,
      });
    },
  );

  // Renders a Story[] as a markdown briefing; shared by today/hot/curated resources.
  function storyMarkdown(
    title: string,
    subtitle: string,
    stories: Awaited<ReturnType<typeof getFeaturedStories>>,
  ): string {
    const lines = [`# ${title}`, "", subtitle, ""];
    for (const s of stories) {
      const hkr = s.hkr
        ? ` \`${s.hkr.h ? "H" : "·"}${s.hkr.k ? "K" : "·"}${s.hkr.r ? "R" : "·"}\``
        : "";
      const isEvent = (s.coverage ?? 0) > 1 && s.clusterId != null;
      const coverageBadge = isEvent ? ` · **${s.coverage} sources**` : "";
      const stillDeveloping = s.stillDeveloping ? " · *still developing*" : "";
      const headline =
        isEvent && s.canonicalTitleEn ? s.canonicalTitleEn : s.title;
      lines.push(
        `## [${headline}](${s.url})`,
        `*${s.source.publisher}* · importance ${s.importance}${coverageBadge}${stillDeveloping}${hkr}`,
        "",
        s.summary,
        "",
        s.editorNote ? `> ${s.editorNote}` : "",
        "",
      );
    }
    return lines.filter(Boolean).join("\n");
  }

  server.registerResource(
    "today",
    "ax-radar://today",
    {
      title: "Today's hot events (热点聚合)",
      description:
        "Today's importance-sorted hot feed — same as the homepage 热点聚合 tab. Multi-source events ranked by editorial importance, plus today's high-signal singletons. Research papers (arxiv/HF Papers) are excluded — see ax-radar://papers for those. Cheapest way to ask 'what should I know this morning?'.",
      mimeType: "text/markdown",
    },
    async (uri) => {
      const stories = await getFeaturedStories({
        tier: "featured",
        locale: "en",
        limit: 30,
        includeSourceGroup: true,
        view: "today",
        excludeSourceTags: ["arxiv", "paper"],
      });
      const today = new Date().toISOString().slice(0, 10);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text: storyMarkdown(
              `AX Radar — 热点聚合 · ${today}`,
              `${stories.length} item(s). Tier = featured + p1. Importance-sorted. Papers excluded.`,
              stories,
            ),
          },
        ],
      };
    },
  );

  server.registerResource(
    "curated",
    "ax-radar://curated",
    {
      title: "AX严选 — operator-curated stream",
      description:
        "Hand-picked publishers the operator surfaces independently of the importance scorer (鸭哥/grapeot, AI 群聊日报, etc.). Use this to see what the human editor specifically chose to highlight, regardless of tier. Same as the homepage AX 严选 tab. Returns the most recent items across all curated sources.",
      mimeType: "text/markdown",
    },
    async (uri) => {
      const stories = await getFeaturedStories({
        tier: "all",
        locale: "en",
        limit: 30,
        includeSourceGroup: true,
        curatedOnly: true,
      });
      const today = new Date().toISOString().slice(0, 10);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text: storyMarkdown(
              `AX Radar — AX 严选 · ${today}`,
              `${stories.length} item(s) from operator-curated publishers.`,
              stories,
            ),
          },
        ],
      };
    },
  );

  server.registerResource(
    "papers",
    "ax-radar://papers",
    {
      title: "Recent research papers (论文)",
      description:
        "Latest items from arxiv + HuggingFace Papers feeds. Same as the homepage 论文 tab.",
      mimeType: "text/markdown",
    },
    async (uri) => {
      const stories = await getFeaturedStories({
        tier: "all",
        locale: "en",
        limit: 30,
        includeSourceGroup: true,
        includeSourceTags: ["arxiv", "paper"],
      });
      const today = new Date().toISOString().slice(0, 10);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text: storyMarkdown(
              `AX Radar — 论文 · ${today}`,
              `${stories.length} paper(s) from arxiv + HF Papers.`,
              stories,
            ),
          },
        ],
      };
    },
  );

  return server;
}

async function handle(req: Request): Promise<Response> {
  const auth = await requireApiToken(req);
  if (auth instanceof Response) return auth;

  const server = buildServer(auth.user);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
    enableJsonResponse: true,
  });
  await server.connect(transport);
  const res = await transport.handleRequest(req);
  return res;
}

export async function POST(req: Request) {
  return handle(req);
}

export async function GET(req: Request) {
  return handle(req);
}

export async function DELETE(req: Request) {
  return handle(req);
}
