"use client";
import type { ReactNode } from "react";
import { TopBar, type TopBarStats } from "./top-bar";
import { LeftRail } from "./left-rail";
import { Tweaks } from "./tweaks";
import { MobileChrome } from "./mobile-chrome";
import { TweaksProvider } from "@/hooks/use-tweaks";
import type { PulsePoint } from "./pulse-box";

/**
 * Page shell — every view renders its main-column + optional right-rail
 * inside <ViewShell>. Wraps the TweaksProvider so all children share one
 * site-config state.
 */
export function ViewShell({
  locale,
  stats,
  pulse,
  crumb,
  cmd,
  children,
}: {
  locale: "en" | "zh";
  stats: TopBarStats;
  pulse?: PulsePoint[];
  crumb?: string;
  cmd?: string;
  children: ReactNode;
}) {
  return (
    <TweaksProvider initialLanguage={locale}>
      <TopBar stats={stats} crumb={crumb} cmd={cmd} />
      <div className="shell">
        <LeftRail locale={locale} pulse={pulse} />
        {children}
      </div>
      <MobileChrome locale={locale} />
      <Tweaks />
    </TweaksProvider>
  );
}
