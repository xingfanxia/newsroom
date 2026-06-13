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
import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { requireApiToken } from "@/lib/auth/api-token";
import {
  getFeaturedStories,
  getEventMembers,
  type FeedQuery,
} from "@/lib/items/live";
import { runFeedQuery } from "@/lib/api/feed-results";
import { runSearchQuery } from "@/lib/api/search-results";
import { getItemDetail } from "@/lib/items/detail";
import { toAgentApiItem } from "@/lib/api/v1-items";
import { toEventMemberApiItems } from "@/lib/api/event-members";
import { applyFeedbackToggle } from "@/lib/feedback/toggle";
import {
  assignSavedItemCollection,
  getSavedItemCollectionId,
  listCollections,
  userOwnsSavedCollection,
} from "@/lib/items/collections";
import {
  listSourceCatalogRows,
  toMcpSourceApiItem,
} from "@/lib/api/source-catalog";
import {
  dailyColumnDateSchema,
  getDailyColumnRowByDate,
  getLatestDailyColumnRow,
  renderDailyColumnMarkdown,
} from "@/lib/api/daily-columns";
import {
  getUsageSummary,
  USAGE_WINDOWS,
} from "@/lib/api/usage-summary";
import {
  APP_LOCALES,
  FEEDBACK_SAVE_VOTE,
  FEED_VIEWS,
  SEARCH_MODES,
  SOURCE_GROUPS,
  SOURCE_KINDS,
  VISIBLE_ITEM_TIERS,
} from "@/lib/types";
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
        "Return curated items from the AX Radar timeline. Each row is a single editorial card: a singleton article OR a multi-source EVENT (multiple publishers covering the same real-world story merged into one card). When `coverage > 1` the row is an event — use ax_radar_event_members to see all the sources covering it. `view=today` is the importance-sorted hot feed (热点聚合) — what matters today, including events still developing. `view=archive` (default) is the chronological calendar timeline keyed on the lead's published_at. `tier=featured` is today's signal, `tier=all` spans everything non-excluded. Set `curated_only=true` for the operator-curated AX严选 stream (hand-picked publishers like 鸭哥/grapeot, 群聊日报). Use source_id/source_group/source_kind or source tag filters when you need a narrower slice.",
      inputSchema: {
        tier: z.enum(VISIBLE_ITEM_TIERS).optional(),
        view: z.enum(FEED_VIEWS).optional(),
        hot_window_hours: z.number().int().min(1).max(168).optional(),
        source_id: z.string().optional(),
        source_group: z.enum(SOURCE_GROUPS).optional(),
        source_kind: z.enum(SOURCE_KINDS).optional(),
        curated_only: z.boolean().optional(),
        exclude_source_tags: z.array(z.string()).optional(),
        include_source_tags: z.array(z.string()).optional(),
        date: z.string().optional(),
        date_from: z.string().optional(),
        date_to: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional(),
        locale: z.enum(APP_LOCALES).optional(),
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
      const result = await runFeedQuery(q);
      return text({
        items: result.items.map((s) => toAgentApiItem(s, locale)),
        total: result.total,
        limit: result.limit,
        offset: result.offset,
        view: result.view,
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
        locale: z.enum(APP_LOCALES).optional(),
      },
    },
    async ({ cluster_id, locale }) => {
      const members = await getEventMembers(cluster_id, locale ?? "en");
      return text({
        cluster_id,
        members: toEventMemberApiItems(members),
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
        locale: z.enum(APP_LOCALES).optional(),
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
        mode: z.enum(SEARCH_MODES).optional(),
        source_id: z.string().optional(),
        source_group: z.enum(SOURCE_GROUPS).optional(),
        source_kind: z.enum(SOURCE_KINDS).optional(),
        date_from: z.string().optional(),
        date_to: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
        locale: z.enum(APP_LOCALES).optional(),
      },
    },
    async (args) => {
      const mode = args.mode ?? "lexical";
      const limit = args.limit ?? 20;
      const locale = args.locale ?? "en";
      const result = await runSearchQuery({
        q: args.q,
        mode,
        tier: "all",
        locale,
        limit,
        offset: 0,
        source_id: args.source_id,
        source_group: args.source_group,
        source_kind: args.source_kind,
        date_from: args.date_from,
        date_to: args.date_to,
        semanticIncludeExcluded: false,
      });

      if (result.mode === "semantic") {
        return text({
          mode: "semantic",
          q: args.q,
          items: result.items.map((s) => {
            return {
              ...toAgentApiItem(s, locale),
              distance: s.distance,
            };
          }),
          total: result.total,
        });
      }

      return text({
        mode: "lexical",
        q: args.q,
        items: result.items.map((s) => toAgentApiItem(s, locale)),
        total: result.total,
      });
    },
  );

  server.registerTool(
    "ax_radar_sources",
    {
      title: "List monitored sources + live health",
      description:
        "Return the monitored source catalog (podcasts, newsletters, vendor blogs, deep-report feeds, X handles, ...) with current health: status, consecutive failures, last success, total items ingested. Useful for answering 'do we even watch X?' before phrasing a broader query.",
      inputSchema: {},
    },
    async () => {
      const rows = await listSourceCatalogRows("id");
      return text({
        sources: rows.map(toMcpSourceApiItem),
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
        if (
          on &&
          collection_id !== undefined &&
          !(await userOwnsSavedCollection(user.id, collection_id))
        ) {
          return error("collection_not_found");
        }

        const votes = await applyFeedbackToggle(user, {
          itemId: item_id,
          vote: FEEDBACK_SAVE_VOTE,
          on,
          note,
        });

        let collectionId: number | null = null;
        if (votes.save && collection_id !== undefined) {
          const assigned = await assignSavedItemCollection({
            userId: user.id,
            itemId: item_id,
            targetCollectionId: collection_id,
          });
          if (!assigned.ok) {
            return error(assigned.reason);
          }
          collectionId = assigned.collectionId;
        } else if (votes.save) {
          collectionId = await getSavedItemCollectionId(user.id, item_id);
        }

        return text({
          item_id,
          saved: votes.save,
          collection_id: collectionId,
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
        "Return recent LLM cost + token usage for a time window. Useful for chatty agents to budget check before firing a batch. Fields: totals, by_task, by_model, and recent_calls with provider/model labels.",
      inputSchema: {
        window: z.enum(USAGE_WINDOWS).optional(),
      },
    },
    async ({ window }) => {
      const w = window ?? "week";
      return text(await getUsageSummary(w));
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
        "Today's importance-sorted hot feed — same as the homepage 热点聚合 tab. Multi-source events ranked by editorial importance, plus today's high-signal singletons. Cheapest way to ask 'what should I know this morning?'.",
      mimeType: "text/markdown",
    },
    async (uri) => {
      const stories = await getFeaturedStories({
        tier: "featured",
        locale: "en",
        limit: 30,
        includeSourceGroup: true,
        view: "today",
      });
      const today = new Date().toISOString().slice(0, 10);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text: storyMarkdown(
              `AX Radar — 热点聚合 · ${today}`,
              `${stories.length} item(s). Tier = featured + p1. Importance-sorted.`,
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

  // ── Daily column resources ─────────────────────────────────────
  server.registerResource(
    "daily-latest",
    "ax-radar://daily/latest",
    {
      title: "Latest daily AI column",
      description:
        "The most recent daily AI column written in a clear, friend-sharing voice. Title format: 'AX 的 AI 日报 · YYYY-MM-DD'. Body has a short skim layer and a 2500-4500 字 narrative that explains what happened, why it matters, and where to be cautious. Selection draws from today's 严选 ∪ top hot items. Cron writes one per day at ~9pm PT.",
      mimeType: "text/markdown",
    },
    async (uri) => {
      const row = await getLatestDailyColumnRow("zh");
      if (!row) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "text/markdown",
              text: "_今日的日报还没生成_",
            },
          ],
        };
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text: renderDailyColumnMarkdown(row),
          },
        ],
      };
    },
  );

  server.registerResource(
    "daily-by-date",
    new ResourceTemplate("ax-radar://daily/{date}", { list: undefined }),
    {
      title: "Daily AI column by date",
      description:
        "Daily column for a specific date (YYYY-MM-DD). Returns the column written for the 24h window ending on that date's 9pm PT cron tick. 404-equivalent empty resource when no column exists for that date.",
      mimeType: "text/markdown",
    },
    async (uri, variables) => {
      const date = String(variables.date ?? "");
      if (!dailyColumnDateSchema.safeParse(date).success) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "text/markdown",
              text: "_invalid date format — expected YYYY-MM-DD_",
            },
          ],
        };
      }
      const row = await getDailyColumnRowByDate(date, "zh");
      if (!row) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "text/markdown",
              text: `_no column for ${date}_`,
            },
          ],
        };
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text: renderDailyColumnMarkdown(row),
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
