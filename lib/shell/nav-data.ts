/**
 * Left-rail + mobile-drawer navigation data. Bilingual labels resolved at
 * render time from the tweaks.language setting (EN or 中文).
 */

export type NavItem = {
  id: string;
  href: string;
  label: string;
  cjk: string;
  badge?: string | number;
  live?: boolean;
};

export const NAV_PRIMARY: NavItem[] = [
  { id: "hot",        href: "/",             label: "hot feed",   cjk: "热点资讯", live: true },
  { id: "all",        href: "/all",          label: "all posts",  cjk: "全部" },
  { id: "podcasts",   href: "/podcasts",     label: "podcasts",   cjk: "播客·视频" },
  { id: "lowfollow",  href: "/low-follower", label: "viral",      cjk: "低粉爆文" },
  { id: "xmonitor",   href: "/x-monitor",    label: "X monitor",  cjk: "X 监控" },
  { id: "saved",      href: "/saved",        label: "saved",      cjk: "收藏" },
  { id: "sources",    href: "/sources",      label: "sources",    cjk: "信源" },
];

export const NAV_ADMIN: NavItem[] = [
  { id: "usage",      href: "/admin/usage",      label: "usage",      cjk: "用量" },
  { id: "system",     href: "/admin/system",     label: "system",     cjk: "系统" },
  { id: "policy",     href: "/admin/policy",     label: "curation",   cjk: "精选策略" },
  { id: "iterations", href: "/admin/iterations", label: "iterations", cjk: "策略迭代" },
  { id: "users",      href: "/admin/users",      label: "users",      cjk: "用户" },
];

/** Active nav id derivation from the current pathname (locale-stripped). */
export function activeNavId(pathname: string): string | null {
  // Strip leading /en or /zh
  const rest = pathname.replace(/^\/(en|zh)(?=\/|$)/, "") || "/";
  const direct = [...NAV_PRIMARY, ...NAV_ADMIN].find((n) => n.href === rest);
  if (direct) return direct.id;
  // Prefix match (e.g. /podcasts/123 → podcasts)
  const prefix = [...NAV_PRIMARY, ...NAV_ADMIN].find(
    (n) => n.href !== "/" && rest.startsWith(n.href + "/"),
  );
  return prefix?.id ?? "hot";
}
