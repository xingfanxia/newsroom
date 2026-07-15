/**
 * GET /openapi.yaml — Public OpenAPI 3.1 spec for /api/public/*.
 *
 * Generated agents + tools can pull this to auto-generate SDK clients.
 * Kept inline as a template literal so it's editable in one place — no
 * build step, no YAML parser to maintain.
 */
import {
  APP_LOCALES,
  CADENCES,
  FEED_VIEWS,
  ITEM_TIERS,
  SEARCH_MODES,
  SOURCE_GROUPS,
  SOURCE_HEALTH_STATUSES,
  SOURCE_KINDS,
  SOURCE_LOCALES,
  VISIBLE_ITEM_TIERS,
} from "@/lib/types";
import {
  DAILY_COLUMN_INDEX_TAKE_MAX,
  DAILY_COLUMN_INDEX_TAKE_MIN,
  DEFAULT_DAILY_COLUMN_INDEX_TAKE,
  DEFAULT_DAILY_COLUMN_QUERY_LOCALE,
} from "@/lib/daily-column/query-defaults";
import {
  DEFAULT_API_FEED_LOCALE,
  DEFAULT_FEED_HOT_WINDOW_HOURS,
  DEFAULT_FEED_LIMIT,
  DEFAULT_FEED_OFFSET,
  DEFAULT_FEED_TIER,
  DEFAULT_FEED_VIEW,
  FEED_HOT_WINDOW_HOURS_MAX,
  FEED_HOT_WINDOW_HOURS_MIN,
  FEED_LIMIT_MIN,
  PUBLIC_FEED_LIMIT_MAX,
} from "@/lib/feed/query-defaults";
import {
  DEFAULT_API_SEARCH_LOCALE,
  DEFAULT_SEARCH_LIMIT,
  DEFAULT_SEARCH_MODE,
  DEFAULT_SEARCH_OFFSET,
  DEFAULT_SEARCH_TIER,
  PUBLIC_SEMANTIC_SEARCH_ERROR,
  PUBLIC_SEARCH_LIMIT_MAX,
  SEARCH_LIMIT_MIN,
} from "@/lib/search/query-defaults";
import { DEFAULT_PUBLIC_EVENT_MEMBERS_LOCALE } from "@/lib/event-members/query-defaults";
import { publicRateLimitPerIpLabel } from "@/lib/api/public-endpoint-config";
import { PUBLIC_SITE_URL, publicUrl } from "@/lib/site";

function yamlInlineEnum(values: readonly (string | null)[]): string {
  return `[${values.map((value) => (value === null ? "null" : value)).join(", ")}]`;
}

const APP_LOCALE_ENUM = yamlInlineEnum(APP_LOCALES);
const CADENCE_ENUM = yamlInlineEnum(CADENCES);
const FEED_VIEW_ENUM = yamlInlineEnum(FEED_VIEWS);
const ITEM_TIER_ENUM = yamlInlineEnum(ITEM_TIERS);
const SEARCH_MODE_ENUM = yamlInlineEnum(SEARCH_MODES);
const SOURCE_GROUP_ENUM = yamlInlineEnum(SOURCE_GROUPS);
const SOURCE_GROUP_NULLABLE_ENUM = yamlInlineEnum([...SOURCE_GROUPS, null]);
const SOURCE_HEALTH_STATUS_ENUM = yamlInlineEnum(SOURCE_HEALTH_STATUSES);
const SOURCE_KIND_ENUM = yamlInlineEnum(SOURCE_KINDS);
const SOURCE_LOCALE_ENUM = yamlInlineEnum(SOURCE_LOCALES);
const VISIBLE_ITEM_TIER_ENUM = yamlInlineEnum(VISIBLE_ITEM_TIERS);
const SEARCH_RATE_LIMIT_PER_IP = publicRateLimitPerIpLabel("search");

const OPENAPI_YAML = `openapi: 3.1.0
info:
  title: AX Radar Public API
  version: "1.0.0"
  description: |
    Anonymous read-only API for AX Radar (${PUBLIC_SITE_URL}) — AI intelligence
    radar with curated featured items, hand-picked editor stream (AX 严选),
    multi-source event clustering, and daily AI columns in a clear editorial
    voice.

    **No auth required.** Per-IP rate limit + weak ETag.
    Mirrors the bearer-gated /api/v1/* surface read-only, with LLM-internal
    fields (raw reasoning, per-axis HKR explanations) stripped.

    Testing phase — endpoints + shapes may change. Don't hard-depend in production.
  contact:
    name: AX
    url: ${publicUrl("/zh/agents")}
  license:
    name: MIT
servers:
  - url: ${PUBLIC_SITE_URL}
    description: production
tags:
  - name: feed
    description: Browse the radar — featured / curated / events
  - name: items
    description: Full item detail
  - name: search
    description: Anonymous lexical search
  - name: events
    description: Multi-source event coverage
  - name: daily
    description: Daily AI columns
  - name: sources
    description: Source catalog + health

paths:
  /api/public/feed:
    get:
      tags: [feed]
      summary: Browse the AX Radar feed
      description: |
        Returns the importance-sorted feed of curated AI items. Each row is
        a singleton article OR a multi-source EVENT (use \`cluster_id\` +
        \`/events/{id}/members\` to drill in). Default returns the featured
        archive feed (\`tier=${DEFAULT_FEED_TIER}\`, \`view=${DEFAULT_FEED_VIEW}\`).
        Set \`view=today\` for the hot/recent event window.
      parameters:
        - { name: tier, in: query, schema: { type: string, enum: ${VISIBLE_ITEM_TIER_ENUM}, default: ${DEFAULT_FEED_TIER} } }
        - { name: view, in: query, schema: { type: string, enum: ${FEED_VIEW_ENUM}, default: ${DEFAULT_FEED_VIEW} } }
        - { name: hot_window_hours, in: query, schema: { type: integer, minimum: ${FEED_HOT_WINDOW_HOURS_MIN}, maximum: ${FEED_HOT_WINDOW_HOURS_MAX}, default: ${DEFAULT_FEED_HOT_WINDOW_HOURS} } }
        - { name: date, in: query, schema: { type: string, pattern: '^\\d{4}-\\d{2}-\\d{2}$' } }
        - { name: date_from, in: query, schema: { type: string, format: date-time } }
        - { name: date_to, in: query, schema: { type: string, format: date-time } }
        - { name: source_id, in: query, schema: { type: string } }
        - { name: source_group, in: query, schema: { type: string, enum: ${SOURCE_GROUP_ENUM} } }
        - { name: source_kind, in: query, schema: { type: string, enum: ${SOURCE_KIND_ENUM} } }
        - { name: curated_only, in: query, schema: { type: string, enum: ['true', 'false', '1', '0'] }, description: "Limit to AX 严选 / curated sources only" }
        - { name: include_source_tags, in: query, schema: { type: string }, description: "Comma-separated source tag list" }
        - { name: exclude_source_tags, in: query, schema: { type: string } }
        - { name: limit, in: query, schema: { type: integer, minimum: ${FEED_LIMIT_MIN}, maximum: ${PUBLIC_FEED_LIMIT_MAX}, default: ${DEFAULT_FEED_LIMIT} } }
        - { name: offset, in: query, schema: { type: integer, minimum: 0, default: ${DEFAULT_FEED_OFFSET} } }
        - { name: locale, in: query, schema: { type: string, enum: ${APP_LOCALE_ENUM}, default: ${DEFAULT_API_FEED_LOCALE} } }
      responses:
        '200':
          description: OK
          headers:
            ETag:
              schema: { type: string }
              description: 'Weak ETag: W/"public-feed-<hash16>". Pass back as If-None-Match to skip duplicate transfers.'
          content:
            application/json:
              schema: { $ref: '#/components/schemas/FeedResponse' }
        '304':
          description: Not modified (If-None-Match matched)
        '400': { $ref: '#/components/responses/BadRequest' }
        '429': { $ref: '#/components/responses/RateLimited' }
        '500': { $ref: '#/components/responses/ServerError' }

  /api/public/items/{id}:
    get:
      tags: [items]
      summary: Full detail for one item
      description: |
        Returns bilingual title/summary, editor note + multi-paragraph
        editor_analysis (锐评), HKR booleans, body_md (transcript for
        YT, article body for RSS), tags, plus an event block if the item
        belongs to a multi-member cluster.
      parameters:
        - { name: id, in: path, required: true, schema: { type: integer } }
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ItemDetail' }
        '304': { description: Not modified }
        '400': { $ref: '#/components/responses/BadRequest' }
        '404': { $ref: '#/components/responses/NotFound' }
        '429': { $ref: '#/components/responses/RateLimited' }
        '500': { $ref: '#/components/responses/ServerError' }

  /api/public/search:
    get:
      tags: [search]
      summary: Keyword (lexical) search
      description: |
        Anonymous lexical search (${SEARCH_RATE_LIMIT_PER_IP}).
        \`mode=lexical\` (default) does LIKE substring against title/summary;
        \`mode=semantic\` returns HTTP 422 with
        \`{"error":"${PUBLIC_SEMANTIC_SEARCH_ERROR}"}\`. Semantic search remains
        available only on bearer-authenticated v1/MCP surfaces; the anonymous
        route never queries Turso or invokes an embedding provider.
      parameters:
        - { name: q, in: query, required: true, schema: { type: string, minLength: 1 } }
        - { name: mode, in: query, schema: { type: string, enum: ${SEARCH_MODE_ENUM}, default: ${DEFAULT_SEARCH_MODE} } }
        - { name: tier, in: query, schema: { type: string, enum: ${VISIBLE_ITEM_TIER_ENUM}, default: ${DEFAULT_SEARCH_TIER} } }
        - { name: date_from, in: query, schema: { type: string, format: date-time } }
        - { name: date_to, in: query, schema: { type: string, format: date-time } }
        - { name: source_id, in: query, schema: { type: string } }
        - { name: source_group, in: query, schema: { type: string, enum: ${SOURCE_GROUP_ENUM} } }
        - { name: source_kind, in: query, schema: { type: string, enum: ${SOURCE_KIND_ENUM} } }
        - { name: limit, in: query, schema: { type: integer, minimum: ${SEARCH_LIMIT_MIN}, maximum: ${PUBLIC_SEARCH_LIMIT_MAX}, default: ${DEFAULT_SEARCH_LIMIT} } }
        - { name: offset, in: query, schema: { type: integer, minimum: 0, default: ${DEFAULT_SEARCH_OFFSET} }, description: "lexical mode only" }
        - { name: locale, in: query, schema: { type: string, enum: ${APP_LOCALE_ENUM}, default: ${DEFAULT_API_SEARCH_LOCALE} } }
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema: { $ref: '#/components/schemas/SearchResponse' }
        '304': { description: Not modified }
        '400': { $ref: '#/components/responses/BadRequest' }
        '422':
          description: Anonymous semantic search is not supported
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Error' }
              example: { error: ${PUBLIC_SEMANTIC_SEARCH_ERROR} }
        '429': { $ref: '#/components/responses/RateLimited' }
        '500': { $ref: '#/components/responses/ServerError' }

  /api/public/sources:
    get:
      tags: [sources]
      summary: Source catalog + live health
      description: Source catalog monitored by AX Radar — podcasts / newsletters / vendor blogs / deep-report feeds / X handles. Use to answer "is X covered?" before filtering a feed query.
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema: { $ref: '#/components/schemas/SourcesResponse' }
        '304': { description: Not modified }
        '429': { $ref: '#/components/responses/RateLimited' }
        '500': { $ref: '#/components/responses/ServerError' }

  /api/public/events/{cluster_id}/members:
    get:
      tags: [events]
      summary: Cross-source coverage list for a multi-source event
      description: |
        Given a \`cluster_id\` from the feed (rows where \`coverage > 1\` are
        multi-source events), returns the full list of items comprising the
        event — title / source / url / importance — ordered by importance.
        Unknown cluster_id returns 200 with empty \`members\` array so consumer
        agents can degrade gracefully without a separate error path.
      parameters:
        - { name: cluster_id, in: path, required: true, schema: { type: integer } }
        - { name: locale, in: query, schema: { type: string, enum: ${APP_LOCALE_ENUM}, default: ${DEFAULT_PUBLIC_EVENT_MEMBERS_LOCALE} } }
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema: { $ref: '#/components/schemas/EventMembersResponse' }
        '304': { description: Not modified }
        '400': { $ref: '#/components/responses/BadRequest' }
        '429': { $ref: '#/components/responses/RateLimited' }
        '500': { $ref: '#/components/responses/ServerError' }

  /api/public/daily:
    get:
      tags: [daily]
      summary: Latest daily AI column
      description: |
        Daily AI column in a clear, friend-sharing editorial voice. Cron writes
        one per day at ~9pm PT covering the prior 24h. Returns: title (≤20 字),
        theme tag (≤8 字), summary_md (numbered 1-5 list with backlinks),
        narrative_md (2500-4500 字 narrative).
      parameters:
        - { name: locale, in: query, schema: { type: string, enum: ${APP_LOCALE_ENUM}, default: ${DEFAULT_DAILY_COLUMN_QUERY_LOCALE} }, description: "Only ${DEFAULT_DAILY_COLUMN_QUERY_LOCALE} is generated today" }
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema: { $ref: '#/components/schemas/DailyColumn' }
        '304': { description: Not modified }
        '400': { $ref: '#/components/responses/BadRequest' }
        '404': { description: No daily yet today }
        '429': { $ref: '#/components/responses/RateLimited' }
        '500': { $ref: '#/components/responses/ServerError' }

  /api/public/daily/{date}:
    get:
      tags: [daily]
      summary: Daily AI column for a specific date
      parameters:
        - { name: date, in: path, required: true, schema: { type: string, pattern: '^\\d{4}-\\d{2}-\\d{2}$' } }
        - { name: locale, in: query, schema: { type: string, enum: ${APP_LOCALE_ENUM}, default: ${DEFAULT_DAILY_COLUMN_QUERY_LOCALE} } }
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema: { $ref: '#/components/schemas/DailyColumn' }
        '304': { description: Not modified }
        '400': { $ref: '#/components/responses/BadRequest' }
        '404': { description: No column for that date }
        '429': { $ref: '#/components/responses/RateLimited' }
        '500': { $ref: '#/components/responses/ServerError' }

  /api/public/dailies:
    get:
      tags: [daily]
      summary: Daily column index (discovery)
      description: Recent daily columns in reverse-chronological order — metadata only (no body), useful for "which dates have columns" enumeration.
      parameters:
        - { name: take, in: query, schema: { type: integer, minimum: ${DAILY_COLUMN_INDEX_TAKE_MIN}, maximum: ${DAILY_COLUMN_INDEX_TAKE_MAX}, default: ${DEFAULT_DAILY_COLUMN_INDEX_TAKE} } }
        - { name: locale, in: query, schema: { type: string, enum: ${APP_LOCALE_ENUM}, default: ${DEFAULT_DAILY_COLUMN_QUERY_LOCALE} } }
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema: { $ref: '#/components/schemas/DailiesIndex' }
        '304': { description: Not modified }
        '400': { $ref: '#/components/responses/BadRequest' }
        '429': { $ref: '#/components/responses/RateLimited' }
        '500': { $ref: '#/components/responses/ServerError' }

components:
  schemas:
    FeedItem:
      type: object
      required: [id, title, summary, publisher, source_id, tier, importance, url, published_at]
      properties:
        id: { type: string }
        title: { type: string }
        summary: { type: string }
        publisher: { type: string, description: "Display name of the source" }
        source_id: { type: string, description: "Canonical source id, e.g. 'dwarkesh-yt'. Use this for filters, not publisher." }
        source_group: { type: string, nullable: true, enum: ${SOURCE_GROUP_NULLABLE_ENUM} }
        source_kind: { type: string, enum: ${SOURCE_KIND_ENUM} }
        tier: { type: string, enum: ${ITEM_TIER_ENUM} }
        importance: { type: integer, minimum: 0, description: "Editorial importance score" }
        hkr:
          nullable: true
          type: object
          description: "Happy/Knowledge/Resonance rubric booleans (per-axis reasoning stripped from public payload)"
          properties:
            h: { type: boolean }
            k: { type: boolean }
            r: { type: boolean }
        tags:
          type: array
          items: { type: string }
        url: { type: string, format: uri }
        published_at: { type: string, format: date-time }
        has_commentary: { type: boolean, description: "True iff editor_note or editor_analysis is populated (fetch /items/{id} for the body)" }
        cluster_id: { type: integer, nullable: true, description: "Set when this item is part of a multi-source event. Use with /events/{id}/members." }
        coverage: { type: integer, nullable: true, description: "Member count of the cluster (=1 means singleton)" }
        canonical_title: { type: string, nullable: true, description: "Neutral event name for multi-source events; null for singletons" }
        first_seen_at: { type: string, format: date-time, nullable: true }
        latest_member_at: { type: string, format: date-time, nullable: true }

    FeedResponse:
      type: object
      required: [items, total, limit, offset, view]
      properties:
        items:
          type: array
          items: { $ref: '#/components/schemas/FeedItem' }
        total: { type: integer }
        limit: { type: integer }
        offset: { type: integer }
        view: { type: string, enum: ${FEED_VIEW_ENUM} }

    ItemDetail:
      type: object
      required: [id, source, title, summary, url, published_at, importance, tier]
      properties:
        id: { type: string }
        source:
          type: object
          properties:
            id: { type: string }
            name_en: { type: string, nullable: true }
            name_zh: { type: string, nullable: true }
            kind: { type: string, enum: ${SOURCE_KIND_ENUM} }
            group: { type: string, enum: ${SOURCE_GROUP_ENUM} }
            locale: { type: string, enum: ${SOURCE_LOCALE_ENUM} }
            url: { type: string, format: uri }
        title:
          type: object
          properties:
            raw: { type: string }
            zh: { type: string, nullable: true }
            en: { type: string, nullable: true }
        summary:
          type: object
          properties:
            zh: { type: string, nullable: true }
            en: { type: string, nullable: true }
        editor_note:
          type: object
          properties:
            zh: { type: string, nullable: true }
            en: { type: string, nullable: true }
        editor_analysis:
          type: object
          description: "锐评 — 200字 cap, featured/p1 only"
          properties:
            zh: { type: string, nullable: true }
            en: { type: string, nullable: true }
        hkr:
          nullable: true
          type: object
          properties:
            h: { type: boolean }
            k: { type: boolean }
            r: { type: boolean }
        tags:
          type: object
          properties:
            capabilities: { type: array, items: { type: string } }
            entities:     { type: array, items: { type: string } }
            topics:       { type: array, items: { type: string } }
        importance: { type: integer }
        tier: { type: string, enum: ${ITEM_TIER_ENUM} }
        url: { type: string, format: uri }
        canonical_url: { type: string, format: uri, nullable: true }
        author: { type: string, nullable: true }
        published_at: { type: string, format: date-time }
        enriched_at: { type: string, format: date-time, nullable: true }
        commentary_at: { type: string, format: date-time, nullable: true }
        body_md: { type: string, nullable: true, description: "Markdown body — transcript for YT, article text for RSS" }
        event:
          nullable: true
          type: object
          description: "Populated when item belongs to a multi-source cluster. null for singletons."
          properties:
            cluster_id: { type: integer }
            coverage: { type: integer }
            tier: { type: string }
            importance: { type: integer }
            first_seen_at: { type: string, format: date-time, nullable: true }
            latest_member_at: { type: string, format: date-time, nullable: true }
            canonical_title:
              type: object
              properties:
                zh: { type: string, nullable: true }
                en: { type: string, nullable: true }
            editor_note:
              type: object
              properties:
                zh: { type: string, nullable: true }
                en: { type: string, nullable: true }
            editor_analysis:
              type: object
              properties:
                zh: { type: string, nullable: true }
                en: { type: string, nullable: true }
            members_url: { type: string }

    SearchResponse:
      type: object
      required: [mode, q, items, total, limit]
      properties:
        mode: { type: string, enum: [lexical] }
        q: { type: string }
        items:
          type: array
          items: { $ref: '#/components/schemas/FeedItem' }
        total: { type: integer, description: "Total matches for the filtered query; stable across limit/offset pages." }
        limit: { type: integer }
        offset: { type: integer }

    EventMembersResponse:
      type: object
      required: [cluster_id, members, total]
      properties:
        cluster_id: { type: integer }
        members:
          type: array
          items:
            type: object
            properties:
              source_id: { type: string }
              source_name: { type: string }
              title: { type: string }
              url: { type: string, format: uri }
              published_at: { type: string, format: date-time }
              importance: { type: integer }
        total: { type: integer }

    SourceEntry:
      type: object
      properties:
        id: { type: string }
        name_en: { type: string, nullable: true }
        name_zh: { type: string, nullable: true }
        url: { type: string, format: uri }
        kind: { type: string, enum: ${SOURCE_KIND_ENUM} }
        group: { type: string, enum: ${SOURCE_GROUP_ENUM} }
        locale: { type: string, enum: ${SOURCE_LOCALE_ENUM} }
        cadence: { type: string, enum: ${CADENCE_ENUM} }
        priority: { type: integer, minimum: 1, maximum: 3 }
        tags: { type: array, items: { type: string } }
        enabled: { type: boolean }
        curated: { type: boolean }
        health:
          type: object
          properties:
            status: { type: string, enum: ${SOURCE_HEALTH_STATUS_ENUM} }
            last_success_at: { type: string, format: date-time, nullable: true }
            consecutive_failures: { type: integer }
            total_items_count: { type: integer }

    SourcesResponse:
      type: object
      properties:
        sources:
          type: array
          items: { $ref: '#/components/schemas/SourceEntry' }
        total: { type: integer }

    DailyColumn:
      type: object
      required: [id, locale, date, generated_at, window_start, window_end]
      properties:
        id: { type: integer }
        locale: { type: string, enum: ${APP_LOCALE_ENUM} }
        date: { type: string, description: "YYYY-MM-DD UTC of period_start" }
        generated_at: { type: string, format: date-time }
        window_start: { type: string, format: date-time }
        window_end: { type: string, format: date-time }
        title: { type: string, nullable: true, description: "≤20 字 headline" }
        theme_tag: { type: string, nullable: true, description: "≤8 字 day theme" }
        summary_md: { type: string, nullable: true, description: "Numbered 1-5 markdown list, 50-100 字 per entry" }
        narrative_md: { type: string, nullable: true, description: "2500-4500 字 narrative" }
        featured_item_ids: { type: array, items: { type: integer } }
        item_ids: { type: array, items: { type: integer } }
        story_count: { type: integer }

    DailiesIndex:
      type: object
      properties:
        count: { type: integer }
        items:
          type: array
          items:
            type: object
            properties:
              id: { type: integer }
              date: { type: string }
              generated_at: { type: string, format: date-time }
              title: { type: string, nullable: true }
              theme_tag: { type: string, nullable: true }
              story_count: { type: integer }

    Error:
      type: object
      required: [error]
      properties:
        error: { type: string }

  responses:
    BadRequest:
      description: Invalid query / parameter
      content:
        application/json:
          schema: { $ref: '#/components/schemas/Error' }
    NotFound:
      description: Resource not found
      content:
        application/json:
          schema: { $ref: '#/components/schemas/Error' }
    RateLimited:
      description: Per-IP rate limit hit
      headers:
        Retry-After:
          schema: { type: integer }
          description: Seconds until the bucket resets
      content:
        application/json:
          schema: { $ref: '#/components/schemas/Error' }
    ServerError:
      description: Internal error
      content:
        application/json:
          schema: { $ref: '#/components/schemas/Error' }
`;

export const dynamic = "force-static";

export async function GET(): Promise<Response> {
  return new Response(OPENAPI_YAML, {
    status: 200,
    headers: {
      "content-type": "application/yaml; charset=utf-8",
      "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400",
      "access-control-allow-origin": "*",
    },
  });
}
