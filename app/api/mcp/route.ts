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
 *   ax-radar://today           — today's hot feed as markdown
 *   ax-radar://curated         — operator-curated stream as markdown
 *   ax-radar://daily/latest    — latest daily AI column as markdown
 *   ax-radar://daily/{date}    — daily AI column by date
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
import { getFeaturedStories } from "@/lib/items/live";
import {
  feedQueryFromMcpToolArgs,
  mcpFeedToolInputShape,
  mcpSearchToolInputShape,
  searchQueryFromMcpToolArgs,
} from "@/lib/api/feed-query-params";
import { getAgentItemDetailRoutePayload } from "@/lib/api/item-detail";
import {
  runFeedQuery,
  toAgentFeedPayload,
} from "@/lib/api/feed-results";
import {
  runSearchQuery,
  toAgentSearchPayload,
} from "@/lib/api/search-results";
import { getEventMembersPayload } from "@/lib/api/event-members";
import { saveItemRoutePayload } from "@/lib/api/saved-routes";
import { listCollections } from "@/lib/items/collections";
import {
  listSourceCatalogRows,
  toMcpSourceApiItem,
} from "@/lib/api/source-catalog";
import {
  getDailyColumnMarkdownByDate,
  getLatestDailyColumnMarkdown,
} from "@/lib/api/daily-columns";
import { DEFAULT_MCP_EVENT_MEMBERS_LOCALE } from "@/lib/event-members/query-defaults";
import {
  getUsageSummary,
  usageSummaryWindowSchema,
  usageWindowOrDefault,
} from "@/lib/api/usage-summary";
import { APP_LOCALES } from "@/lib/types";
import type { SessionUser } from "@/lib/auth/session";
import {
  readRequestBytes,
  ResponseBodyTooLargeError,
} from "@/lib/http/response-body";

type ToolOutput = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

const MCP_REQUEST_MAX_BYTES = 256 * 1024;

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
      inputSchema: mcpFeedToolInputShape,
    },
    async (args) => {
      const q = feedQueryFromMcpToolArgs(args);
      const locale = q.locale ?? "en";
      const result = await runFeedQuery(q);
      return text(toAgentFeedPayload(result, locale));
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
      return text(
        await getEventMembersPayload(
          cluster_id,
          locale ?? DEFAULT_MCP_EVENT_MEMBERS_LOCALE,
        ),
      );
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
    async ({ id }) => {
      const found = await getAgentItemDetailRoutePayload(String(id));
      if (!found.ok) {
        return found.error === "not_found"
          ? error(`item ${id} not found`)
          : error(found.error);
      }
      return text(found.payload);
    },
  );

  server.registerTool(
    "ax_radar_search",
    {
      title: "Search the radar by keyword or concept",
      description:
        "Lexical mode (default) does case-insensitive substring match against title + summary. Semantic mode embeds your query and ranks items by libSQL vector cosine distance — better for conceptual queries where the exact phrase isn't in the text (e.g. 'autonomous coding agent' surfaces pieces about IDE automation). Semantic returns a `distance` field per hit (cosine distance, 0 = identical, smaller = closer).",
      inputSchema: mcpSearchToolInputShape,
    },
    async (args) => {
      const q = searchQueryFromMcpToolArgs(args);
      const locale = q.locale;
      const result = await runSearchQuery(q);

      return text(toAgentSearchPayload(result, locale));
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
        const result = await saveItemRoutePayload(user, {
          itemId: item_id,
          on,
          collectionId: collection_id,
          note,
        });
        if (!result.ok) {
          return result.error === "item_not_found"
            ? error(`item ${item_id} not found`)
            : error(result.error);
        }

        return text(result.payload);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
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
        window: usageSummaryWindowSchema,
      },
    },
    async ({ window }) => {
      const w = usageWindowOrDefault(window);
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
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text: await getLatestDailyColumnMarkdown("zh"),
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
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text: await getDailyColumnMarkdownByDate(date, "zh"),
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

  let boundedRequest = req;
  if (req.method === "POST") {
    try {
      const body = await readRequestBytes(req, MCP_REQUEST_MAX_BYTES);
      boundedRequest = new Request(req, {
        body: new TextDecoder().decode(body),
      });
    } catch (error) {
      if (error instanceof ResponseBodyTooLargeError) {
        return Response.json(
          { error: "payload_too_large" },
          { status: 413 },
        );
      }
      return Response.json({ error: "invalid_body" }, { status: 400 });
    }
  }

  const server = buildServer(auth.user);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
    enableJsonResponse: true,
  });
  await server.connect(transport);
  const res = await transport.handleRequest(boundedRequest);
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
