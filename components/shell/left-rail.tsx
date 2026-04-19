"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandLogo } from "./brand-logo";
import { PulseBox, type PulsePoint } from "./pulse-box";
import { useTweaks } from "@/hooks/use-tweaks";
import { NAV_ADMIN, NAV_PRIMARY, activeNavId } from "@/lib/shell/nav-data";

/** Left-rail nav. Bilingual, active-aware, with a pulse-chart + site-config entry. */
export function LeftRail({
  locale,
  pulse,
}: {
  locale: "en" | "zh";
  pulse?: PulsePoint[];
}) {
  const pathname = usePathname() ?? "";
  const activeId = activeNavId(pathname);
  const { tweaks, setOpen } = useTweaks();
  const lang = tweaks.language;
  const showEn = lang === "en";
  const showZh = lang === "zh";

  const hrefFor = (href: string) => `/${locale}${href === "/" ? "" : href}`;

  return (
    <aside className="rail-l scroll-dark">
      <div className="brand">
        <div className="brand-logo">
          <BrandLogo />
        </div>
        <div>
          <div className="brand-name">
            {lang === "zh" ? "ax / 雷达" : "ax / radar"}
          </div>
          <div className="brand-sub">
            {lang === "zh" ? "AI 情报" : "AI intelligence"}
          </div>
        </div>
      </div>

      <div className="search">
        <span className="prompt-dollar">$</span>
        <input
          placeholder={lang === "zh" ? "搜索信源…" : "grep sources…"}
          disabled
          aria-label="search"
        />
        <kbd>⌘K</kbd>
      </div>

      <div className="sec">
        <span>{lang === "zh" ? "频道" : "feeds"}</span>
        <span className="sec-c">{NAV_PRIMARY.length}</span>
      </div>
      {NAV_PRIMARY.map((n) => {
        const active = activeId === n.id;
        const label = showEn ? n.label : n.cjk;
        return (
          <Link
            key={n.id}
            href={hrefFor(n.href)}
            className={`nav-it ${active ? "on" : ""}`}
          >
            <span className="dot-marker" />
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontFamily: showZh ? "var(--font-sans-cjk)" : "var(--font-mono)",
              }}
            >
              {label}
            </span>
            {n.live && <span className="badge live">live</span>}
          </Link>
        );
      })}

      <div className="sec">
        <span>{lang === "zh" ? "后台" : "admin"}</span>
        <span className="sec-c">{NAV_ADMIN.length}</span>
      </div>
      {NAV_ADMIN.map((n) => {
        const active = activeId === n.id;
        const label = showEn ? n.label : n.cjk;
        return (
          <Link
            key={n.id}
            href={hrefFor(n.href)}
            className={`nav-it ${active ? "on" : ""}`}
          >
            <span className="dot-marker" />
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                color: active ? "var(--fg-0)" : "var(--fg-3)",
                fontFamily: showZh ? "var(--font-sans-cjk)" : "var(--font-mono)",
              }}
            >
              {label}
            </span>
            <span />
          </Link>
        );
      })}

      <button
        type="button"
        className="nav-it nav-settings"
        onClick={() => setOpen(true)}
      >
        <span className="dot-marker" />
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            style={{ verticalAlign: -1, marginRight: 6 }}
          >
            <circle cx="8" cy="8" r="2.2" />
            <path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.4 3.4l1.3 1.3M11.3 11.3l1.3 1.3M3.4 12.6l1.3-1.3M11.3 4.7l1.3-1.3" />
          </svg>
          {lang === "zh" ? "站点配置" : "site config"}
        </span>
        <span className="badge" style={{ fontSize: 9 }}>
          ⌥,
        </span>
      </button>

      {tweaks.showPulse && pulse && <PulseBox data={pulse} />}

      <form
        action="/api/admin/logout"
        method="post"
        style={{ marginTop: 14 }}
      >
        <button
          type="submit"
          className="nav-it"
          style={{
            width: "100%",
            color: "var(--fg-3)",
            fontSize: 11,
            background: "transparent",
            border: 0,
            cursor: "pointer",
            padding: "8px 6px",
          }}
        >
          <span className="dot-marker" />
          <span>{lang === "zh" ? "退出登录" : "logout"}</span>
          <span />
        </button>
      </form>
    </aside>
  );
}
