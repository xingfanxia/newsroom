"use client";
import { useTranslations } from "next-intl";
import {
  Flame,
  Newspaper,
  Headphones,
  Rocket,
  Radio,
  Bookmark,
  Rss,
  MonitorCog,
  CircleCheck,
  RefreshCcw,
  Users,
  LogOut,
  type LucideIcon,
} from "lucide-react";
import { Link, usePathname } from "@/i18n/navigation";
import { Logo } from "./logo";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  icon: LucideIcon;
  translationKey: string;
};

const primary: NavItem[] = [
  { href: "/", icon: Flame, translationKey: "hotNews" },
  { href: "/all", icon: Newspaper, translationKey: "allPosts" },
  { href: "/podcasts", icon: Headphones, translationKey: "podcasts" },
  { href: "/low-follower", icon: Rocket, translationKey: "lowFollower" },
  { href: "/x-monitor", icon: Radio, translationKey: "xMonitor" },
  { href: "/saved", icon: Bookmark, translationKey: "saved" },
  { href: "/sources", icon: Rss, translationKey: "sources" },
];

const admin: NavItem[] = [
  { href: "/admin/system", icon: MonitorCog, translationKey: "system" },
  { href: "/admin/policy", icon: CircleCheck, translationKey: "policy" },
  { href: "/admin/iterations", icon: RefreshCcw, translationKey: "iterations" },
  { href: "/admin/users", icon: Users, translationKey: "users" },
];

export function Sidebar() {
  const t = useTranslations("nav");
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 flex h-dvh w-[204px] shrink-0 flex-col border-r border-[var(--color-border-subtle)] bg-[var(--color-panel)] px-3 py-4">
      <div className="px-2 pb-5">
        <Logo />
      </div>

      <nav className="flex flex-col gap-0.5">
        {primary.map((item) => (
          <NavItem
            key={item.href}
            item={item}
            label={t(item.translationKey)}
            active={isActive(pathname, item.href)}
          />
        ))}
      </nav>

      <div className="mt-6 px-2 pb-1 pt-3">
        <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-faint)]">
          {t("adminLabel")}
        </span>
      </div>
      <nav className="flex flex-col gap-0.5">
        {admin.map((item) => (
          <NavItem
            key={item.href}
            item={item}
            label={t(item.translationKey)}
            active={isActive(pathname, item.href)}
          />
        ))}
      </nav>

      <div className="mt-auto">
        <button
          type="button"
          className="flex h-9 w-full items-center gap-[10px] rounded-md px-3 text-[14px] font-[510] text-[var(--color-fg-muted)] hover:bg-white/[0.04] hover:text-[var(--color-fg)] transition-all"
        >
          <LogOut size={16} />
          <span>{t("logout")}</span>
        </button>
      </div>
    </aside>
  );
}

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/" || pathname === "";
  return pathname === href || pathname.startsWith(href + "/");
}

function NavItem({
  item,
  label,
  active,
}: {
  item: NavItem;
  label: string;
  active: boolean;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href as "/"}
      className={cn(
        "relative flex h-9 items-center gap-[10px] rounded-md px-3 text-[14px] font-[510] transition-all",
        active
          ? "bg-[rgba(62,230,230,0.08)] text-[var(--color-cyan)] shadow-[inset_2px_0_0_#3ee6e6,0_0_18px_rgba(62,230,230,0.12)]"
          : "text-[var(--color-fg-muted)] hover:bg-white/[0.04] hover:text-[var(--color-fg)]",
      )}
    >
      <Icon size={16} className={active ? "text-[var(--color-cyan)]" : ""} />
      <span>{label}</span>
    </Link>
  );
}
