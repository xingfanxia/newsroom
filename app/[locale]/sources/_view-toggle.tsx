"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTweaks } from "@/hooks/use-tweaks";
import {
  DEFAULT_SOURCES_VIEW,
  SOURCES_VIEW_LABELS,
  SOURCES_VIEWS,
  type SourcesView,
} from "@/lib/sources/view";

/** Segmented toggle between table + card views. Persists via URL param. */
export function SourcesViewToggle({ view }: { view: SourcesView }) {
  const pathname = usePathname();
  const { tweaks } = useTweaks();
  const zh = tweaks.language === "zh";
  const hrefForView = (nextView: SourcesView) =>
    nextView === DEFAULT_SOURCES_VIEW
      ? pathname
      : `${pathname}?view=${nextView}`;

  return (
    <div className="fil-grp" style={{ marginLeft: "auto" }}>
      {SOURCES_VIEWS.map((nextView) => {
        const label = SOURCES_VIEW_LABELS[nextView];
        return (
          <Link
            key={nextView}
            href={hrefForView(nextView)}
            className={`fil ${view === nextView ? "on" : ""}`}
            style={{ textDecoration: "none", borderBottomWidth: 0 }}
          >
            {label.icon} {zh ? label.zh : label.en}
          </Link>
        );
      })}
    </div>
  );
}
