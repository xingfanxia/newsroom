import {
  readDirectPublicFeedStories,
  readDirectPublicNewsletters,
  supportsDirectPublicRouteReads,
} from "@/lib/public-content/direct-route-read";
import {
  renderLegacyPublicRss,
  renderLegacyDailyPublicRssFromRows,
  renderLegacyPublicRssFromStories,
  renderMainPublicRss,
  renderMainPublicRssFromStories,
  renderStructuredNewsletterPublicRss,
  renderStructuredNewsletterPublicRssFromNewsletters,
  type PublicRssArtifact,
} from "@/lib/public-content/rss";
import { publicSnapshotReader } from "@/lib/public-content/reader";
import { isPublicSnapshotUnavailableError } from "@/lib/public-content/reader/types";
import type { PublicReleaseReadScope } from "@/lib/public-content/reader/types";
import {
  materializedPageLogicalName,
  readScopedMaterializedPageModel,
} from "@/lib/public-content/materialized-artifact";
import type { PublicDailyColumn } from "@/lib/public-content/public-dailies";
import type { LegacyRssSlug } from "@/lib/rss/legacy-feed-meta";
import { rssResponse } from "@/lib/rss/render";
import type { AppLocale } from "@/lib/types";

const MAX_RENDERED_RELEASE_VARIANTS = 24;
const renderedArtifacts = new Map<string, PublicRssArtifact>();

export async function mainPublicRssResponse(
  locale: AppLocale,
): Promise<Response> {
  return snapshotRssResponse(
    `main:${locale}`,
    (state, nowMs) => renderMainPublicRss(state, locale, nowMs),
    async (scope, nowMs) => {
      let result = await readDirectPublicFeedStories(
        scope,
        { tier: "featured", locale, limit: 50, recencyFloorDays: 14 },
        nowMs,
      );
      if (result.stories.length === 0) {
        result = await readDirectPublicFeedStories(
          scope,
          { tier: "all", locale, limit: 50 },
          nowMs,
        );
      }
      return renderMainPublicRssFromStories(result.stories, locale, nowMs);
    },
  );
}

export async function newsletterPublicRssResponse(
  locale: AppLocale,
): Promise<Response> {
  return snapshotRssResponse(
    `newsletter:${locale}`,
    (state, nowMs) => renderStructuredNewsletterPublicRss(state, locale, nowMs),
    async (scope, nowMs) =>
      renderStructuredNewsletterPublicRssFromNewsletters(
        await readDirectPublicNewsletters(scope),
        locale,
        nowMs,
      ),
  );
}

export async function legacyPublicRssResponse(
  slug: LegacyRssSlug,
): Promise<Response> {
  return snapshotRssResponse(
    `legacy:${slug}`,
    (state, nowMs) => renderLegacyPublicRss(state, slug, nowMs),
    async (scope, nowMs) => {
      if (slug === "daily") {
        const model = await readScopedMaterializedPageModel<{
          rows: PublicDailyColumn[];
        }>(scope, materializedPageLogicalName.daily("zh"));
        return renderLegacyDailyPublicRssFromRows(
          model.rows,
          nowMs,
        );
      }
      const result = await readDirectPublicFeedStories(
        scope,
        {
          tier: "all",
          locale: "zh",
          curatedOnly: slug === "curated",
          limit: 50,
        },
        nowMs,
      );
      return renderLegacyPublicRssFromStories(result.stories, slug, nowMs);
    },
  );
}

async function snapshotRssResponse(
  variant: string,
  renderLegacy: (state: unknown, nowMs: number) => PublicRssArtifact,
  renderDirect: (
    scope: PublicReleaseReadScope,
    nowMs: number,
  ) => Promise<PublicRssArtifact>,
): Promise<Response> {
  try {
    const scoped = await publicSnapshotReader().readReleaseScoped(async (scope) => {
      const publishedAt = scope.release.pointer.publishedAt;
      const nowMs = Date.parse(publishedAt);
      const cacheKey = `${scope.release.ref.manifestSha256}:${publishedAt}:${variant}`;
      let artifact = renderedArtifacts.get(cacheKey);
      if (!artifact) {
        artifact = supportsDirectPublicRouteReads(scope.release)
          ? await renderDirect(scope, nowMs)
          : renderLegacy((await scope.readCanonicalState()).state, nowMs);
        rememberArtifact(cacheKey, artifact);
      }
      return artifact;
    });
    return rssResponse(scoped.value.xml);
  } catch (error) {
    if (!isPublicSnapshotUnavailableError(error)) throw error;
    return new Response("snapshot unavailable", {
      status: 503,
      headers: {
        "cache-control": "no-store",
        "content-type": "text/plain; charset=utf-8",
        "retry-after": "60",
      },
    });
  }
}

function rememberArtifact(key: string, artifact: PublicRssArtifact): void {
  renderedArtifacts.set(key, artifact);
  while (renderedArtifacts.size > MAX_RENDERED_RELEASE_VARIANTS) {
    const oldest = renderedArtifacts.keys().next().value;
    if (oldest === undefined) return;
    renderedArtifacts.delete(oldest);
  }
}

export function __resetPublicRssArtifacts(): void {
  renderedArtifacts.clear();
}
