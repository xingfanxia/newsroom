import { setRequestLocale } from "next-intl/server";
import type { Metadata } from "next";
import { ViewShell } from "@/components/shell/view-shell";
import { PageHead } from "@/components/shell/page-head";
import { readAgentsPageModel } from "@/lib/public-content/page-models";
import { AgentsTabs } from "./_tabs";
import { PUBLIC_ENDPOINT_COUNT } from "@/lib/api/public-endpoint-config";
import { publicUrl } from "@/lib/site";
import { appLocaleFromParam } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Agent access — AX Radar",
  description:
    "把 AX Radar 接进 Claude Code / RSS reader / 任意 Agent — Skill / RSS / REST API 三轨匿名访问。",
};

export default async function AgentsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = appLocaleFromParam(locale);
  setRequestLocale(appLocale);

  const { chrome } = await readAgentsPageModel();

  return (
    <ViewShell
      locale={appLocale}
      stats={chrome.topBarStats}
      pulse={chrome.pulse}
      crumb="~/agents"
      cmd={`curl ${publicUrl("/api/public/feed")}`}
    >
      <main className="main">
        <PageHead
          en="agent access"
          cjk="Agent 接入"
          count={PUBLIC_ENDPOINT_COUNT}
          countLabel="endpoints"
          extra={
            <span
              style={{
                color: "var(--accent-yellow, #d29922)",
                fontSize: 11,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
              }}
            >
              beta · 测试版
            </span>
          }
        />
        <AgentsTabs />
      </main>
    </ViewShell>
  );
}
