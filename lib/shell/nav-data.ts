/**
 * Left-rail + mobile-drawer navigation data. Bilingual labels resolved at
 * render time from the tweaks.language setting (EN or 中文).
 */
import { stripAppLocalePathPrefix, type AppLocale } from "@/lib/types";

export type NavItem = {
  id: string;
  href: string;
  label: string;
  cjk: string;
  mobileLabel?: string;
  mobileCjk?: string;
  badge?: string | number;
  live?: boolean;
};

export const NAV_PRIMARY: NavItem[] = [
  {
    id: "hot",
    href: "/",
    label: "hot events",
    cjk: "热点聚合",
    mobileLabel: "feed",
    mobileCjk: "热点",
    live: true,
  },
  { id: "daily",      href: "/daily",        label: "daily column", cjk: "每日 AI 日报" },
  { id: "all",        href: "/all",          label: "all posts",  cjk: "全部" },
  { id: "podcasts",   href: "/podcasts",     label: "podcasts",   cjk: "播客·视频" },
  { id: "curated",    href: "/curated",      label: "curated",    cjk: "AX 严选" },
  {
    id: "xmonitor",
    href: "/x-monitor",
    label: "X monitor",
    cjk: "X 监控",
    mobileLabel: "X",
    mobileCjk: "监控",
  },
  { id: "saved",      href: "/saved",        label: "saved",      cjk: "收藏" },
  { id: "sources",    href: "/sources",      label: "sources",    cjk: "信源" },
  { id: "agents",     href: "/agents",       label: "agent access", cjk: "Agent 接入" },
];

export const NAV_ADMIN: NavItem[] = [
  { id: "usage",      href: "/admin/usage",      label: "usage",      cjk: "用量" },
  { id: "system",     href: "/admin/system",     label: "system",     cjk: "系统" },
  { id: "policy",     href: "/admin/policy",     label: "curation",   cjk: "精选策略" },
  { id: "iterations", href: "/admin/iterations", label: "iterations", cjk: "策略迭代" },
  { id: "users",      href: "/admin/users",      label: "users",      cjk: "用户" },
];

function mobileTabFromPrimaryNav(id: string): NavItem {
  const item = NAV_PRIMARY.find((navItem) => navItem.id === id);
  if (!item) throw new Error(`unknown primary nav item: ${id}`);
  return {
    ...item,
    label: item.mobileLabel ?? item.label,
    cjk: item.mobileCjk ?? item.cjk,
  };
}

export const NAV_MOBILE_TABS: NavItem[] = [
  mobileTabFromPrimaryNav("hot"),
  mobileTabFromPrimaryNav("xmonitor"),
  { id: "radar", href: "#", label: "radar", cjk: "雷达" },
  mobileTabFromPrimaryNav("saved"),
  { id: "more", href: "#", label: "more", cjk: "更多" },
];

export function navHrefForLocale(locale: AppLocale, href: string): string {
  return href === "#" ? "#" : `/${locale}${href === "/" ? "" : href}`;
}

/** Active nav id derivation from the current pathname (locale-stripped). */
export function activeNavId(pathname: string): string | null {
  const rest = stripAppLocalePathPrefix(pathname);
  const direct = [...NAV_PRIMARY, ...NAV_ADMIN].find((n) => n.href === rest);
  if (direct) return direct.id;
  // Prefix match (e.g. /podcasts/123 → podcasts)
  const prefix = [...NAV_PRIMARY, ...NAV_ADMIN].find(
    (n) => n.href !== "/" && rest.startsWith(n.href + "/"),
  );
  return prefix?.id ?? "hot";
}
