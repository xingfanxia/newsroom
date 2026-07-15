import {
  renderLegacyPublicRss,
  renderMainPublicRss,
  renderStructuredNewsletterPublicRss,
  type PublicRssArtifact,
} from "@/lib/public-content/rss";
import { publicSnapshotReader } from "@/lib/public-content/reader";
import { isPublicSnapshotUnavailableError } from "@/lib/public-content/reader/types";
import type { LegacyRssSlug } from "@/lib/rss/legacy-feed-meta";
import { rssResponse } from "@/lib/rss/render";
import type { AppLocale } from "@/lib/types";

const MAX_RENDERED_RELEASE_VARIANTS = 24;
const renderedArtifacts = new Map<string, PublicRssArtifact>();

export async function mainPublicRssResponse(
  locale: AppLocale,
): Promise<Response> {
  return snapshotRssResponse(`main:${locale}`, (state, nowMs) =>
    renderMainPublicRss(state, locale, nowMs),
  );
}

export async function newsletterPublicRssResponse(
  locale: AppLocale,
): Promise<Response> {
  return snapshotRssResponse(`newsletter:${locale}`, (state, nowMs) =>
    renderStructuredNewsletterPublicRss(state, locale, nowMs),
  );
}

export async function legacyPublicRssResponse(
  slug: LegacyRssSlug,
): Promise<Response> {
  return snapshotRssResponse(`legacy:${slug}`, (state, nowMs) =>
    renderLegacyPublicRss(state, slug, nowMs),
  );
}

async function snapshotRssResponse(
  variant: string,
  render: (state: unknown, nowMs: number) => PublicRssArtifact,
): Promise<Response> {
  try {
    const snapshot = await publicSnapshotReader().readCanonicalState();
    const publishedAt = snapshot.release.pointer.publishedAt;
    const cacheKey = `${snapshot.release.ref.manifestSha256}:${publishedAt}:${variant}`;
    let artifact = renderedArtifacts.get(cacheKey);
    if (!artifact) {
      artifact = render(snapshot.state, Date.parse(publishedAt));
      rememberArtifact(cacheKey, artifact);
    }
    return rssResponse(artifact.xml);
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
