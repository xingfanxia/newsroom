import type { SavedCollection } from "@/lib/items/collections";
import { resolveSavedCollectionSelection } from "@/lib/items/saved-collection-selection";
import type { ShellChromeData } from "@/lib/shell/chrome-data";
import {
  appLocaleFromParam,
  type AppLocale,
  type Story,
} from "@/lib/types";
import type { SessionUser } from "@/lib/auth/session-identity";

export type SavedPageProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ collection?: string }>;
};

type SavedTotals = {
  total: number;
  thisWeek: number;
  thisMonth: number;
};

type SavedStory = Story & {
  savedAt: string;
  collectionId: number | null;
};

type SavedTag = { tag: string; count: number };

export type SavedPageDependencies = {
  getSessionUser: () => Promise<SessionUser | null>;
  upsertAppUser: (user: SessionUser) => Promise<void>;
  listCollections: (userId: string) => Promise<SavedCollection[]>;
  getInboxCount: (userId: string) => Promise<number>;
  getSavedTotals: (userId: string) => Promise<SavedTotals>;
  getShellChromeData: (opts: { pulse: true }) => Promise<ShellChromeData>;
  getSavedStories: (
    userId: string,
    locale: AppLocale,
    opts: { collection: number | "inbox" },
  ) => Promise<SavedStory[]>;
  getSavedTags: (
    userId: string,
    opts: { collection: number | "inbox" },
  ) => Promise<SavedTag[]>;
  setRequestLocale: (locale: AppLocale) => void;
  redirect: (destination: string) => never;
};

/**
 * Hard authorization boundary plus all saved-page data loading. Dependencies
 * are explicit so the deny-before-database invariant is executable without
 * process-global module mocks or importing database-backed implementations.
 */
export async function loadSavedPageRequest(
  { params, searchParams }: SavedPageProps,
  dependencies: SavedPageDependencies,
) {
  const { locale } = await params;
  const appLocale = appLocaleFromParam(locale);

  const user = await dependencies.getSessionUser();
  if (!user) {
    const next = encodeURIComponent(`/${appLocale}/saved`);
    dependencies.redirect(`/${appLocale}/login?next=${next}`);
  }

  dependencies.setRequestLocale(appLocale);
  await dependencies.upsertAppUser(user);
  const sp = await searchParams;
  const userId = user.id;

  const [collections, inboxCount, totals, chrome] = await Promise.all([
    dependencies.listCollections(userId).catch(() => []),
    dependencies.getInboxCount(userId).catch(() => 0),
    dependencies
      .getSavedTotals(userId)
      .catch(() => ({ total: 0, thisWeek: 0, thisMonth: 0 })),
    dependencies.getShellChromeData({ pulse: true }),
  ]);
  const selection = resolveSavedCollectionSelection(sp.collection, collections);
  if (selection.shouldRedirect) dependencies.redirect(`/${appLocale}/saved`);

  const { activeId, collectionFilter } = selection;
  const [stories, tags] = await Promise.all([
    dependencies
      .getSavedStories(userId, appLocale, { collection: collectionFilter })
      .catch(() => []),
    dependencies
      .getSavedTags(userId, { collection: collectionFilter })
      .catch(() => []),
  ]);

  return {
    appLocale,
    collections,
    inboxCount,
    totals,
    chrome,
    activeId,
    stories,
    tags,
  };
}
