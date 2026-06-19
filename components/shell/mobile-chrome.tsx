"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useTweaks } from "@/hooks/use-tweaks";
import {
  NAV_ADMIN,
  NAV_MOBILE_TABS,
  NAV_PRIMARY,
  activeNavId,
  navHrefForLocale,
} from "@/lib/shell/nav-data";
import type { AppLocale } from "@/lib/types";

/** Mobile bottom tab bar + bottom-sheet drawer. Only visible under 720px. */
export function MobileChrome({ locale }: { locale: AppLocale }) {
  const pathname = usePathname() ?? "";
  const activeId = activeNavId(pathname);
  const [open, setOpen] = useState(false);
  const { tweaks, setOpen: setTweakOpen } = useTweaks();
  const lang = tweaks.language;
  const showEn = lang === "en";

  return (
    <>
      <nav className="m-tabbar">
        {NAV_MOBILE_TABS.map((t) => {
          const isActive = activeId === t.id;
          const label = showEn ? t.label : t.cjk;
          if (t.id === "more") {
            return (
              <button
                key={t.id}
                type="button"
                className={`m-tab ${open ? "on" : ""}`}
                onClick={() => setOpen(true)}
              >
                <span className="ic">
                  <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
                    <circle cx="5" cy="10" r="1.6" />
                    <circle cx="10" cy="10" r="1.6" />
                    <circle cx="15" cy="10" r="1.6" />
                  </svg>
                </span>
                <span className={showEn ? "" : "cjk"}>{label}</span>
              </button>
            );
          }
          return (
            <Link
              key={t.id}
              href={navHrefForLocale(locale, t.href)}
              className={`m-tab ${isActive ? "on" : ""}`}
            >
              <span className="ic">
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
                  {t.id === "hot" && (
                    <>
                      <path d="M3 5h14M3 10h14M3 15h10" />
                    </>
                  )}
                  {t.id === "xmonitor" && (
                    <path fill="currentColor" d="M13 3h3l-6 7 7 7h-3l-5-5-4 5H2l6-7L2 3h3l4 5 4-5z" />
                  )}
                  {t.id === "radar" && (
                    <>
                      <circle cx="10" cy="10" r="7" />
                      <circle cx="10" cy="10" r="3.5" />
                      <path d="M10 3v14M3 10h14" />
                    </>
                  )}
                  {t.id === "saved" && <path d="M5 3h10v15l-5-3-5 3V3z" />}
                </svg>
              </span>
              <span className={showEn ? "" : "cjk"}>{label}</span>
            </Link>
          );
        })}
      </nav>

      <div
        className={`m-drawer-scrim ${open ? "on" : ""}`}
        onClick={() => setOpen(false)}
      />
      <div className={`m-drawer ${open ? "on" : ""} scroll-dark`}>
        <div className="handle" />
        <div className="dhd">
          <h3>{lang === "zh" ? "更多" : "more"}</h3>
          <span className="close" onClick={() => setOpen(false)} role="button">
            ✕
          </span>
        </div>
        <div className="sect">
          <h4>{lang === "zh" ? "频道" : "feeds"}</h4>
          <div className="opts">
            {NAV_PRIMARY.map((n) => (
              <Link
                key={n.id}
                href={navHrefForLocale(locale, n.href)}
                className={`opt ${activeId === n.id ? "on" : ""}`}
                onClick={() => setOpen(false)}
              >
                {showEn ? n.label : n.cjk}
                {n.badge && <span className="c">{n.badge}</span>}
              </Link>
            ))}
          </div>
        </div>
        <div className="sect">
          <h4>{lang === "zh" ? "后台" : "admin"}</h4>
          <div className="opts">
            {NAV_ADMIN.map((n) => (
              <Link
                key={n.id}
                href={navHrefForLocale(locale, n.href)}
                className={`opt ${activeId === n.id ? "on" : ""}`}
                onClick={() => setOpen(false)}
              >
                {showEn ? n.label : n.cjk}
              </Link>
            ))}
            <button
              type="button"
              className="opt accent"
              onClick={() => {
                setTweakOpen(true);
                setOpen(false);
              }}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                style={{ marginRight: 6, verticalAlign: -2 }}
              >
                <circle cx="8" cy="8" r="2.2" />
                <path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.4 3.4l1.3 1.3M11.3 11.3l1.3 1.3M3.4 12.6l1.3-1.3M11.3 4.7l1.3-1.3" />
              </svg>
              {lang === "zh" ? "站点配置" : "site config"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
