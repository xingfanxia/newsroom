"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTweaks } from "@/hooks/use-tweaks";

export type SourcesView = "table" | "cards";

/** Segmented toggle between table + card views. Persists via URL param. */
export function SourcesViewToggle({ view }: { view: SourcesView }) {
  const pathname = usePathname();
  const { tweaks } = useTweaks();
  const zh = tweaks.language === "zh";
  return (
    <div className="fil-grp" style={{ marginLeft: "auto" }}>
      <Link
        href={pathname}
        className={`fil ${view === "table" ? "on" : ""}`}
        style={{ textDecoration: "none", borderBottomWidth: 0 }}
      >
        ☰ {zh ? "表格" : "table"}
      </Link>
      <Link
        href={`${pathname}?view=cards`}
        className={`fil ${view === "cards" ? "on" : ""}`}
        style={{ textDecoration: "none", borderBottomWidth: 0 }}
      >
        ▦ {zh ? "卡片" : "cards"}
      </Link>
    </div>
  );
}
