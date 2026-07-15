/**
 * Exhaustive App Router serving inventory for the public-read boundary.
 *
 * `appPath` is the raw Next app-path manifest key. It deliberately retains
 * route groups and parallel slots; `pathname` is the request path after Next's
 * app-path normalization. Keeping both prevents two distinct bundles that
 * render the same URL from being collapsed by verification tooling.
 */

type EntrypointAccess =
  | "snapshot-only"
  | "static-public"
  | "private-authenticated"
  | "operator-authenticated";
export type EntrypointKind = "page" | "route";
export type EntrypointMethod = "GET" | "HEAD";
export type EntrypointRepresentation = "HTML" | "RSC";
export type ServingSurface = EntrypointMethod | EntrypointRepresentation;

export interface PublicServingEntrypoint {
  readonly access: EntrypointAccess;
  readonly appPath: string;
  readonly buildModule: string;
  readonly kind: EntrypointKind;
  readonly methods: readonly EntrypointMethod[];
  readonly pathname: string;
  readonly representations: readonly EntrypointRepresentation[];
  /** Null only for framework-generated entries with no repository source. */
  readonly sourcePath: string | null;
  readonly surfaces: readonly ServingSurface[];
}

export function servingSurfacesFor(
  kind: EntrypointKind,
  methods: readonly EntrypointMethod[] = ["GET", "HEAD"],
): readonly ServingSurface[] {
  return kind === "page"
    ? ([...methods, "HTML", "RSC"] as const)
    : [...methods];
}

interface PublicServingEntrypointInput {
  readonly access: EntrypointAccess;
  readonly appPath: string;
  readonly buildModule?: string;
  readonly kind: EntrypointKind;
  readonly methods?: readonly EntrypointMethod[];
  readonly pathname: string;
  readonly sourcePath: string | null;
}

export function defineServingEntrypoint(
  input: PublicServingEntrypointInput,
): PublicServingEntrypoint {
  const requestedMethods = input.methods ?? ["GET", "HEAD"];
  const methods = (["GET", "HEAD"] as const).filter(
    (method) =>
      requestedMethods.includes(method) ||
      (method === "HEAD" && requestedMethods.includes("GET")),
  );
  const representations =
    input.kind === "page" ? (["HTML", "RSC"] as const) : ([] as const);
  const buildModule =
    input.buildModule ??
    input.sourcePath?.replace(/\.(?:ts|tsx|js|jsx)$/, ".js");
  if (!buildModule) {
    throw new Error(`Framework entry ${input.appPath} needs a build module`);
  }

  return Object.freeze({
    ...input,
    buildModule,
    methods,
    representations,
    surfaces: servingSurfacesFor(input.kind, methods),
  });
}

function page(
  access: EntrypointAccess,
  appPath: string,
  pathname: string,
  sourcePath: string | null,
  buildModule?: string,
): PublicServingEntrypoint {
  return defineServingEntrypoint({ access, appPath, buildModule, kind: "page", pathname, sourcePath });
}

function route(
  access: EntrypointAccess,
  appPath: string,
  pathname: string,
  sourcePath: string,
  buildModule?: string,
): PublicServingEntrypoint {
  return defineServingEntrypoint({ access, appPath, buildModule, kind: "route", pathname, sourcePath });
}

const SNAPSHOT_PAGES = [
  page("snapshot-only", "/[locale]/agents/page", "/[locale]/agents", "app/[locale]/agents/page.tsx"),
  page("snapshot-only", "/[locale]/all/page", "/[locale]/all", "app/[locale]/all/page.tsx"),
  page("snapshot-only", "/[locale]/curated/page", "/[locale]/curated", "app/[locale]/curated/page.tsx"),
  page("snapshot-only", "/[locale]/daily/[date]/page", "/[locale]/daily/[date]", "app/[locale]/daily/[date]/page.tsx"),
  page("snapshot-only", "/[locale]/daily/page", "/[locale]/daily", "app/[locale]/daily/page.tsx"),
  page("snapshot-only", "/[locale]/page", "/[locale]", "app/[locale]/page.tsx"),
  page("snapshot-only", "/[locale]/podcasts/[id]/page", "/[locale]/podcasts/[id]", "app/[locale]/podcasts/[id]/page.tsx"),
  page("snapshot-only", "/[locale]/podcasts/page", "/[locale]/podcasts", "app/[locale]/podcasts/page.tsx"),
  page("snapshot-only", "/[locale]/sources/page", "/[locale]/sources", "app/[locale]/sources/page.tsx"),
  page("snapshot-only", "/[locale]/x-monitor/page", "/[locale]/x-monitor", "app/[locale]/x-monitor/page.tsx"),
] as const;

const SNAPSHOT_ROUTES = [
  route("snapshot-only", "/api/events/[id]/members/route", "/api/events/[id]/members", "app/api/events/[id]/members/route.ts"),
  route("snapshot-only", "/api/feed/[locale]/rss.xml/route", "/api/feed/[locale]/rss.xml", "app/api/feed/[locale]/rss.xml/route.ts"),
  route("snapshot-only", "/api/feed/newsletter/[locale]/rss.xml/route", "/api/feed/newsletter/[locale]/rss.xml", "app/api/feed/newsletter/[locale]/rss.xml/route.ts"),
  route("snapshot-only", "/api/public/dailies/route", "/api/public/dailies", "app/api/public/dailies/route.ts"),
  route("snapshot-only", "/api/public/daily/[date]/route", "/api/public/daily/[date]", "app/api/public/daily/[date]/route.ts"),
  route("snapshot-only", "/api/public/daily/route", "/api/public/daily", "app/api/public/daily/route.ts"),
  route("snapshot-only", "/api/public/events/[id]/members/route", "/api/public/events/[id]/members", "app/api/public/events/[id]/members/route.ts"),
  route("snapshot-only", "/api/public/feed/route", "/api/public/feed", "app/api/public/feed/route.ts"),
  route("snapshot-only", "/api/public/items/[id]/route", "/api/public/items/[id]", "app/api/public/items/[id]/route.ts"),
  route("snapshot-only", "/api/public/search/route", "/api/public/search", "app/api/public/search/route.ts"),
  route("snapshot-only", "/api/public/sources/route", "/api/public/sources", "app/api/public/sources/route.ts"),
  route("snapshot-only", "/api/rss/[slug]/route", "/api/rss/[slug]", "app/api/rss/[slug]/route.ts"),
  route("snapshot-only", "/api/sources/active/route", "/api/sources/active", "app/api/sources/active/route.ts"),
] as const;

const STATIC_PUBLIC = [
  page("static-public", "/[locale]/login/page", "/[locale]/login", "app/[locale]/login/page.tsx"),
  page("static-public", "/_global-error/page", "/_global-error", null, "app/_global-error/page.js"),
  page("static-public", "/_not-found/page", "/_not-found", "app/not-found.tsx", "app/_not-found/page.js"),
  route("static-public", "/openapi.yaml/route", "/openapi.yaml", "app/openapi.yaml/route.ts"),
  route("static-public", "/robots.txt/route", "/robots.txt", "app/robots.ts", "app/robots.txt/route.js"),
  route("static-public", "/sitemap.xml/route", "/sitemap.xml", "app/sitemap.ts", "app/sitemap.xml/route.js"),
  route("static-public", "/skill.md/route", "/skill.md", "app/skill.md/route.ts"),
] as const;

const PRIVATE_PAGES = [
  page("private-authenticated", "/[locale]/admin/iterations/page", "/[locale]/admin/iterations", "app/[locale]/admin/iterations/page.tsx"),
  page("private-authenticated", "/[locale]/admin/policy/page", "/[locale]/admin/policy", "app/[locale]/admin/policy/page.tsx"),
  page("private-authenticated", "/[locale]/admin/system/page", "/[locale]/admin/system", "app/[locale]/admin/system/page.tsx"),
  page("private-authenticated", "/[locale]/admin/usage/page", "/[locale]/admin/usage", "app/[locale]/admin/usage/page.tsx"),
  page("private-authenticated", "/[locale]/admin/users/page", "/[locale]/admin/users", "app/[locale]/admin/users/page.tsx"),
  page("private-authenticated", "/[locale]/saved/page", "/[locale]/saved", "app/[locale]/saved/page.tsx"),
] as const;

const PRIVATE_ROUTES = [
  route("private-authenticated", "/api/admin/collections/route", "/api/admin/collections", "app/api/admin/collections/route.ts"),
  route("private-authenticated", "/api/admin/iterations/[id]/route", "/api/admin/iterations/[id]", "app/api/admin/iterations/[id]/route.ts"),
  route("private-authenticated", "/api/mcp/route", "/api/mcp", "app/api/mcp/route.ts"),
  route("private-authenticated", "/api/saved/export/route", "/api/saved/export", "app/api/saved/export/route.ts"),
  route("private-authenticated", "/api/tweaks/route", "/api/tweaks", "app/api/tweaks/route.ts"),
  route("private-authenticated", "/api/v1/collections/route", "/api/v1/collections", "app/api/v1/collections/route.ts"),
  route("private-authenticated", "/api/v1/events/[id]/members/route", "/api/v1/events/[id]/members", "app/api/v1/events/[id]/members/route.ts"),
  route("private-authenticated", "/api/v1/feed/route", "/api/v1/feed", "app/api/v1/feed/route.ts"),
  route("private-authenticated", "/api/v1/items/[id]/route", "/api/v1/items/[id]", "app/api/v1/items/[id]/route.ts"),
  route("private-authenticated", "/api/v1/saved/route", "/api/v1/saved", "app/api/v1/saved/route.ts"),
  route("private-authenticated", "/api/v1/search/route", "/api/v1/search", "app/api/v1/search/route.ts"),
  route("private-authenticated", "/api/v1/sources/route", "/api/v1/sources", "app/api/v1/sources/route.ts"),
  route("private-authenticated", "/api/v1/tweaks/route", "/api/v1/tweaks", "app/api/v1/tweaks/route.ts"),
  route("private-authenticated", "/api/v1/usage/summary/route", "/api/v1/usage/summary", "app/api/v1/usage/summary/route.ts"),
] as const;

const OPERATOR_ROUTES = [
  "article-body",
  "cluster",
  "commentary",
  "enrich",
  "fetch-daily",
  "fetch-hourly",
  "fetch-weekly",
  "newsletter-daily",
  "newsletter-monthly",
  "normalize",
  "publish-public",
  "score-backfill",
].map((slug) =>
  route(
    "operator-authenticated",
    `/api/cron/${slug}/route`,
    `/api/cron/${slug}`,
    `app/api/cron/${slug}/route.ts`,
  ),
);

export const PUBLIC_SERVING_ENTRYPOINTS = Object.freeze([
  ...SNAPSHOT_PAGES,
  ...SNAPSHOT_ROUTES,
  ...STATIC_PUBLIC,
  ...PRIVATE_PAGES,
  ...PRIVATE_ROUTES,
  ...OPERATOR_ROUTES,
].sort((left, right) => left.appPath.localeCompare(right.appPath)));

export const SNAPSHOT_ONLY_ENTRYPOINTS = Object.freeze(
  PUBLIC_SERVING_ENTRYPOINTS.filter(
    (entrypoint) => entrypoint.access === "snapshot-only",
  ),
);

export const ANONYMOUS_SERVING_ENTRYPOINTS = Object.freeze(
  PUBLIC_SERVING_ENTRYPOINTS.filter(
    (entrypoint) =>
      entrypoint.access === "snapshot-only" ||
      entrypoint.access === "static-public",
  ),
);
