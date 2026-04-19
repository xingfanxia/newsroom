"use client";
import type { ReactNode } from "react";
import { useTweaks } from "@/hooks/use-tweaks";

/**
 * Bilingual page heading — shows English, Chinese, or both based on
 * tweaks.language. Count + live-pill + extra props are all optional.
 */
export function PageHead({
  en,
  cjk,
  count,
  countLabel,
  policyLabel,
  live,
  extra,
}: {
  en: string;
  cjk: string;
  count?: number;
  countLabel?: string;
  policyLabel?: ReactNode;
  live?: ReactNode;
  extra?: ReactNode;
}) {
  const { tweaks } = useTweaks();
  const showEn = tweaks.language === "en";
  const showZh = tweaks.language === "zh";
  return (
    <>
      <div className="page-head">
        <h1>
          {showEn && <span>{en}</span>}
          {showZh && (
            <span className="cn" style={{ marginLeft: showEn ? 10 : 0 }}>
              {cjk}
            </span>
          )}
        </h1>
        {count != null && (
          <span className="count">
            ▸ {count} {countLabel ?? "signals"} · updated 3m ago
          </span>
        )}
      </div>
      <div className="page-sub">
        {live && <span className="pill">{live}</span>}
        {extra}
        {policyLabel && (
          <>
            <span className="sep">·</span>
            <span>{policyLabel}</span>
          </>
        )}
      </div>
    </>
  );
}
