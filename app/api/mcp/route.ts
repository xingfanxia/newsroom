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
        "Return curated items from the AX Radar timeline. Use this as the default 'what's happening' call — tier=featured gives today's signal, tier=all spans everything enriched. Filter by source group (podcast/media/vendor-official/…), source kind (rss/x-api/…), exact source id (e.g. dwarkesh-yt), or a published-date window. Items come back newest-first.",
      inputSchema: {
        tier: z.enum(["featured", "p1", "all"]).optional(),
        source_id: z.string().optional(),
        source_group: z.string().optional(),
        source_kind: z.string().optional(),
        date: z.string().optional(),
        date_from: z.string().optional(),
        date_to: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional(),
        locale: z.enum(["zh", "en"]).optional(),
      },
    },
    async (args) => {
      const q: FeedQuery = {
        tier: args.tier ?? "featured",
        locale: args.locale ?? "en",
        limit: args.limit ?? 40,
        offset: args.offset ?? 0,
        sourceId: args.source_id,
        sourceGroup: args.source_group,
        sourceKind: args.source_kind,
        date: args.date,
        dateFrom: args.date_from,
        dateTo: args.date_to,
        includeSourceGroup: true,
      };
      const [stories, total] = await Promise.all([
        getFeaturedStories(q),
        countFeaturedStories(q),
      ]);
      return text({
        items: stories.map((s) => ({
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
        })),
        total,
        limit: q.limit,
        offset: q.offset,
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

      if (mode === "semantic") {
        const result = await semanticSearch(args.q, {
          locale: args.locale ?? "en",
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
          items: result.items.map((s) => ({
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
          })),
          total: result.total,
        });
      }

      const q: FeedQuery = {
        tier: "all",
        locale: args.locale ?? "en",
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
        items: stories.map((s) => ({
          id: s.id,
          title: s.title,
          summary: s.summary,
          publisher: s.source.publisher,
          source_id: s.sourceId,
          tier: s.tier,
          importance: s.importance,
          url: s.url,
          published_at: s.publishedAt,
        })),
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

  server.registerResource(
    "today",
    "ax-radar://today",
    {
      title: "Today's curated feed",
      description:
        "Today's featured items as a readable markdown briefing — publisher, headline, summary, and HKR chips. Cheapest way to ask 'what should I know this morning?'.",
      mimeType: "text/markdown",
    },
    async (uri) => {
      const stories = await getFeaturedStories({
        tier: "featured",
        locale: "en",
        limit: 30,
        includeSourceGroup: true,
      });
      const today = new Date().toISOString().slice(0, 10);
      const lines = [
        `# AX Radar — ${today}`,
        "",
        `${stories.length} featured item(s). Tier = featured + p1.`,
        "",
      ];
      for (const s of stories) {
        const hkr = s.hkr
          ? ` \`${s.hkr.h ? "H" : "·"}${s.hkr.k ? "K" : "·"}${s.hkr.r ? "R" : "·"}\``
          : "";
        lines.push(
          `## [${s.title}](${s.url})`,
          `*${s.source.publisher}* · importance ${s.importance}${hkr}`,
          "",
          s.summary,
          "",
          s.editorNote ? `> ${s.editorNote}` : "",
          "",
        );
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text: lines.filter(Boolean).join("\n"),
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
