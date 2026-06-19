import { describe, expect, test } from "bun:test";
import {
  appLocaleFromPathname,
  appLocaleFromParam,
  appLocaleLanguageTag,
  DEFAULT_APP_LOCALE,
  isAppLocale,
  stripAppLocalePathPrefix,
} from "@/lib/types";
import { readSource as read } from "@/tests/helpers/source";

const types = read("lib/types.ts");
const routing = read("i18n/routing.ts");
const schema = read("db/schema.ts");
const feedParams = read("lib/api/feed-query-params.ts");
const eventMembers = read("lib/api/event-members.ts");
const dailyColumns = read("lib/api/daily-columns.ts");
const routeResult = read("lib/api/route-result.ts");
const adminRoute = read("lib/api/admin-route.ts");
const sessionRoute = read("lib/api/session-route.ts");
const plainResponse = read("lib/api/plain-response.ts");
const publicHelpers = read("lib/api/public-helpers.ts");
const v1Route = read("lib/api/v1-route.ts");
const savedRequests = read("lib/api/saved-requests.ts");
const feedbackToggle = read("lib/feedback/toggle.ts");
const feedbackMetrics = read("lib/feedback/metrics.ts");
const savedCollections = read("lib/items/collections.ts");
const savedItems = read("lib/items/saved.ts");
const authSession = read("lib/auth/session.ts");
const localeSwitcher = read("components/layout/locale-switcher.tsx");
const iterationRunner = read("components/admin/iteration-runner.tsx");
const iterationsPage = read("app/[locale]/admin/iterations/page.tsx");
const agentIterate = read("workers/agent/iterate.ts");
const iterationRunRoute = read("app/api/admin/iterations/run/route.ts");
const iterationApplyRoute = read("app/api/admin/iterations/[id]/apply/route.ts");
const iterationRejectRoute = read("app/api/admin/iterations/[id]/reject/route.ts");
const iterationRouteHelpers = read("lib/api/iteration-routes.ts");
const mcpRoute = read("app/api/mcp/route.ts");
const v1SavedRoute = read("app/api/v1/saved/route.ts");
const savedExport = read("lib/api/saved-export.ts");
const newsletterRssFeed = read("lib/rss/newsletter-feed.ts");
const sitemap = read("app/sitemap.ts");
const liveItems = read("lib/items/live.ts");
const itemDetail = read("lib/items/detail.ts");
const publicItems = read("lib/api/public-items.ts");
const v1Items = read("lib/api/v1-items.ts");
const storyItemFields = read("lib/api/story-item-fields.ts");
const relativeTime = read("lib/time/relative.ts");
const ticker = read("lib/shell/ticker.ts");
const agentPrompt = read("workers/agent/prompt.ts");
const adminGate = read("lib/auth/admin-gate.ts");
const usageDisplay = read("lib/llm/usage-display.ts");
const fetcher = read("workers/fetcher/index.ts");
const navData = read("lib/shell/nav-data.ts");
const homePage = read("app/[locale]/page.tsx");
const allPage = read("app/[locale]/all/page.tsx");
const curatedPage = read("app/[locale]/curated/page.tsx");
const savedPage = read("app/[locale]/saved/page.tsx");
const podcastsPage = read("app/[locale]/podcasts/page.tsx");
const podcastDetailPage = read("app/[locale]/podcasts/[id]/page.tsx");
const xMonitorPage = read("app/[locale]/x-monitor/page.tsx");
const loginPage = read("app/[locale]/login/page.tsx");
const agentsPage = read("app/[locale]/agents/page.tsx");
const sourcesPage = read("app/[locale]/sources/page.tsx");
const dailyPage = read("app/[locale]/daily/page.tsx");
const dailyDatePage = read("app/[locale]/daily/[date]/page.tsx");
const adminUsagePage = read("app/[locale]/admin/usage/page.tsx");
const adminUsageTables = read("app/[locale]/admin/usage/_usage-tables.tsx");
const adminSystemPage = read("app/[locale]/admin/system/page.tsx");
const adminPolicyPage = read("app/[locale]/admin/policy/page.tsx");
const adminUsersPage = read("app/[locale]/admin/users/page.tsx");
const adminIterationsPage = read("app/[locale]/admin/iterations/page.tsx");
const agentsTabs = read("app/[locale]/agents/_tabs.tsx");
const viewShell = read("components/shell/view-shell.tsx");
const leftRail = read("components/shell/left-rail.tsx");
const mobileChrome = read("components/shell/mobile-chrome.tsx");
const sourcePicker = read("components/shell/source-picker.tsx");
const feedItem = read("components/feed/item.tsx");
const calendarGrid = read("components/feed/calendar-grid.tsx");
const signalDrawer = read("components/feed/signal-drawer.tsx");
const collectionSidebar = read("components/saved/collection-sidebar.tsx");
const xHandlesSidebar = read("components/x-monitor/handles-sidebar.tsx");
const versionTimeline = read("components/admin/version-timeline.tsx");
const tweaksHook = read("hooks/use-tweaks.tsx");

describe("runtime contract source wiring", () => {
  test("app locale language tags are centralized", () => {
    expect(DEFAULT_APP_LOCALE).toBe("zh");
    expect(appLocaleLanguageTag("zh")).toBe("zh-CN");
    expect(appLocaleLanguageTag("en")).toBe("en-US");
    expect(isAppLocale("zh")).toBe(true);
    expect(isAppLocale("en")).toBe(true);
    expect(isAppLocale("fr")).toBe(false);
    expect(appLocaleFromParam("en")).toBe("en");
    expect(appLocaleFromParam("zh")).toBe("zh");
    expect(appLocaleFromParam("fr")).toBe(DEFAULT_APP_LOCALE);
    expect(appLocaleFromParam(undefined)).toBe(DEFAULT_APP_LOCALE);
    expect(appLocaleFromPathname("/zh/admin")).toBe("zh");
    expect(appLocaleFromPathname("/en/saved")).toBe("en");
    expect(appLocaleFromPathname("/admin")).toBeNull();
    expect(stripAppLocalePathPrefix("/zh/admin/users")).toBe("/admin/users");
    expect(stripAppLocalePathPrefix("/en")).toBe("/");
    expect(stripAppLocalePathPrefix("/unknown")).toBe("/unknown");
  });

  test("locales have shared runtime tuples for app routes and source rows", () => {
    expect(types).toContain("export const APP_LOCALES");
    expect(types).toContain("export const DEFAULT_APP_LOCALE");
    expect(types).toContain("const APP_LOCALE_LANGUAGE_TAGS");
    expect(types).toContain("export function appLocaleLanguageTag");
    expect(types).toContain("export function isAppLocale");
    expect(types).toContain("export function appLocaleFromParam");
    expect(types).toContain("export function appLocaleFromPathname");
    expect(types).toContain("export function stripAppLocalePathPrefix");
    expect(types).toContain("export const SOURCE_LOCALES");
    expect(types).toContain("export const NEWSLETTER_LOCALES");
    expect(routing).toContain("@/lib/types");
    expect(routing).toContain("APP_LOCALES");
    expect(routing).toContain("DEFAULT_APP_LOCALE");
    expect(routing).not.toContain('locales: ["zh", "en"]');
    expect(routing).not.toContain('defaultLocale: "zh"');
    expect(localeSwitcher).toContain("APP_LOCALES");
    expect(localeSwitcher).not.toContain('{ value: "zh"');
    expect(localeSwitcher).not.toContain('{ value: "en"');
    expect(schema).toContain('pgEnum("locale_kind", SOURCE_LOCALES)');

    for (const source of [
      feedParams,
      eventMembers,
      mcpRoute,
      savedRequests,
      sitemap,
    ]) {
      expect(source).toContain("APP_LOCALES");
    }
    expect(v1SavedRoute).toContain("@/lib/api/saved-requests");
    expect(dailyColumns).toContain("NEWSLETTER_LOCALES");
    expect(dailyColumns).toContain(".enum(NEWSLETTER_LOCALES)");
    for (const source of [savedExport, newsletterRssFeed]) {
      expect(source).toContain("appLocaleLanguageTag");
      expect(source).not.toContain('locale === "zh" ? "zh-CN" : "en-US"');
    }
    for (const source of [
      adminUsagePage,
      adminIterationsPage,
      calendarGrid,
      versionTimeline,
    ]) {
      expect(source).toContain("appLocaleLanguageTag");
      expect(source).not.toContain('zh ? "zh-CN" : "en-US"');
      expect(source).not.toContain('appLocale === "zh" ? "zh-CN" : "en-US"');
    }
    expect(adminUsageTables).toContain("AppLocaleLanguageTag");
    expect(adminUsageTables).not.toContain('timeLocale: "zh-CN" | "en-US"');

    for (const source of [
      liveItems,
      itemDetail,
      savedItems,
      publicItems,
      v1Items,
      storyItemFields,
      relativeTime,
      feedbackMetrics,
      ticker,
      agentPrompt,
      usageDisplay,
    ]) {
      expect(source).toContain("AppLocale");
      expect(source).not.toContain('"zh" | "en"');
      expect(source).not.toContain('"en" | "zh"');
      expect(source).not.toContain("type Locale = AppLocale");
    }
    expect(adminGate).toContain("appLocaleFromPathname");
    expect(adminGate).not.toContain('as "zh" | "en"');
    for (const source of [adminGate, navData]) {
      expect(source).toContain("stripAppLocalePathPrefix");
      expect(source).not.toContain("(zh|en)");
      expect(source).not.toContain("(en|zh)");
    }
  });

  test("reader route pages normalize locale params through the shared helper", () => {
    for (const source of [
      homePage,
      allPage,
      curatedPage,
      savedPage,
      podcastsPage,
      podcastDetailPage,
      xMonitorPage,
      loginPage,
      agentsPage,
      sourcesPage,
      dailyPage,
      dailyDatePage,
      adminUsagePage,
      adminSystemPage,
      adminPolicyPage,
      adminUsersPage,
      adminIterationsPage,
    ]) {
      expect(source).toContain("appLocaleFromParam");
      expect(source).toContain("const appLocale = appLocaleFromParam(locale)");
      expect(source).toContain("setRequestLocale(appLocale)");
      expect(source).not.toContain("setRequestLocale(locale)");
      expect(source).not.toContain('locale as "zh" | "en"');
      expect(source).not.toContain('locale as "en" | "zh"');
    }
  });

  test("shared UI locale props use the AppLocale contract", () => {
    for (const source of [
      agentsTabs,
      viewShell,
      leftRail,
      mobileChrome,
      sourcePicker,
      feedItem,
      calendarGrid,
      signalDrawer,
      collectionSidebar,
      xHandlesSidebar,
      versionTimeline,
      tweaksHook,
    ]) {
      expect(source).toContain("AppLocale");
      expect(source).not.toContain('"en" | "zh"');
      expect(source).not.toContain('"zh" | "en"');
    }
  });

  test("fetcher support is a named subset of source kind tuples", () => {
    expect(types).toContain("export const FETCHABLE_SOURCE_KINDS");
    expect(fetcher).toContain("FETCHABLE_SOURCE_KINDS");
    expect(fetcher).not.toContain("const SUPPORTED_KINDS");
    expect(fetcher).not.toContain(
      '["rss", "atom", "rsshub", "x-api", "aihot-api"] as const',
    );
  });

  test("feedback vote values have one runtime source of truth", () => {
    expect(types).toContain("export const FEEDBACK_VOTES");
    expect(types).toContain("export const FEEDBACK_SIGNAL_VOTES");
    expect(types).toContain("export const FEEDBACK_SAVE_VOTE");
    expect(schema).toContain('pgEnum("feedback_vote", FEEDBACK_VOTES)');
    expect(feedbackToggle).toContain("z.enum(FEEDBACK_VOTES)");
    expect(feedbackMetrics).toContain("FEEDBACK_SIGNAL_VOTES");
    expect(feedbackMetrics).toContain("FeedbackVote");

    for (const source of [savedCollections, savedItems]) {
      expect(source).toContain("FEEDBACK_SAVE_VOTE");
      expect(source).not.toContain('eq(feedback.vote, "save")');
      expect(source).not.toContain("${feedback.vote} = 'save'");
    }

    for (const source of [schema, feedbackToggle, feedbackMetrics]) {
      expect(source).not.toContain('["up", "down", "save"]');
      expect(source).not.toContain('["up", "down"]');
      expect(source).not.toContain('"up" | "down" | "save"');
    }
  });

  test("route result contracts have one runtime source of truth", () => {
    expect(routeResult).toContain("export type RouteErrorResult");
    expect(routeResult).toContain("export type RouteSuccessResult");
    expect(routeResult).toContain("export type RouteResult");
    expect(routeResult).toContain("export type RequiredPayloadRouteResult");
    expect(routeResult).toContain("export function routeResultPayload");

    for (const source of [adminRoute, sessionRoute, v1Route]) {
      expect(source).toContain("@/lib/api/route-result");
      expect(source).toContain("type RouteResult");
      expect(source).toContain("routeResultPayload(result)");
      expect(source).not.toContain("| { ok: true; payload: T }");
      expect(source).not.toContain("payload?: undefined");
      expect(source).not.toContain("extra?: Record<string, unknown>;");
    }

    for (const source of [plainResponse, publicHelpers]) {
      expect(source).toContain("@/lib/api/route-result");
      expect(source).toContain("RequiredPayloadRouteResult");
      expect(source).not.toContain("| { ok: false; error: string; status: number }");
    }
    expect(publicHelpers).toContain("RouteErrorResult");
  });

  test("user roles and iteration statuses have one runtime source of truth", () => {
    expect(types).toContain("export const USER_ROLES");
    expect(types).toContain("export const ITERATION_STATUSES");
    expect(types).toContain("export const ITERATION_IDLE_STATUS");
    expect(types).toContain("export const ITERATION_RUNNER_TERMINAL_STATUSES");
    expect(schema).toContain('pgEnum("user_role", USER_ROLES)');
    expect(schema).toContain('pgEnum("iteration_status", ITERATION_STATUSES)');
    expect(authSession).toContain("USER_ADMIN_ROLE");
    expect(authSession).toContain("USER_READER_ROLE");
    expect(iterationRunner).toContain("IterationRunnerStatus");
    expect(iterationRunner).toContain("ITERATION_RUNNER_TERMINAL_STATUSES");
    expect(iterationsPage).toContain("isIterationStatus");
    expect(iterationsPage).toContain("ITERATION_IDLE_STATUS");
    expect(agentIterate).toContain("ITERATION_RUNNING_STATUS");
    expect(agentIterate).toContain("ITERATION_PROPOSED_STATUS");
    expect(agentIterate).toContain("ITERATION_FAILED_STATUS");
    expect(iterationRouteHelpers).toContain("ITERATION_PROPOSED_STATUS");
    expect(iterationRouteHelpers).toContain("ITERATION_FAILED_STATUS");
    expect(iterationRouteHelpers).toContain("ITERATION_APPLIED_STATUS");
    expect(iterationRouteHelpers).toContain("ITERATION_REJECTED_STATUS");

    for (const source of [
      schema,
      authSession,
      iterationRunner,
      iterationsPage,
      agentIterate,
      iterationRunRoute,
      iterationApplyRoute,
      iterationRejectRoute,
      iterationRouteHelpers,
    ]) {
      expect(source).not.toContain('["admin", "editor", "reader"]');
      expect(source).not.toContain('"admin" : "reader"');
      expect(source).not.toContain('"running" | "proposed" | "applied" | "rejected" | "failed"');
      expect(source).not.toContain('["idle", "applied", "rejected", "failed"]');
    }
  });
});
