import Link from "next/link";
import { setRequestLocale, getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { ViewShell } from "@/components/shell/view-shell";
import { PageHead } from "@/components/shell/page-head";
import { SubscribeCard } from "@/components/newsletter/subscribe-card";
import { getShellChromeData } from "@/lib/shell/chrome-data";
import { appLocaleFromParam } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Newsletter — AX Radar",
  description: "订阅 AX 的 AI 雷达邮件:每日日报 + 每日精选,每天 13:40 送达。",
};

const BANNER_STATUSES = ["confirmed", "unsubscribed", "invalid"] as const;
type BannerStatus = (typeof BANNER_STATUSES)[number];

function bannerStatus(raw: string | undefined): BannerStatus | null {
  return BANNER_STATUSES.includes(raw as BannerStatus)
    ? (raw as BannerStatus)
    : null;
}

const BANNER_CLASS: Record<BannerStatus, string> = {
  confirmed:
    "border-[var(--accent-green,#3fb950)]/50 text-[var(--accent-green,#3fb950)]",
  unsubscribed: "border-[var(--color-border)] text-[var(--fg-2)]",
  invalid: "border-[var(--color-negative)]/50 text-[var(--color-negative)]",
};

export default async function NewsletterPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { locale } = await params;
  const appLocale = appLocaleFromParam(locale);
  setRequestLocale(appLocale);
  const t = await getTranslations("newsletter");
  const { status } = await searchParams;
  const banner = bannerStatus(status);

  const chrome = await getShellChromeData({ pulse: true });

  return (
    <ViewShell
      locale={appLocale}
      stats={chrome.topBarStats}
      pulse={chrome.pulse}
      crumb="~/newsletter"
      cmd="mail -s 'AX RADAR' subscribe@news.ax0x.ai"
    >
      <main className="main">
        <PageHead
          en="newsletter"
          cjk="邮件订阅"
          extra={
            <span>
              {t("head.tagline")}{" "}
              <Link
                href="/api/rss/daily.xml"
                className="text-[var(--color-cyan)] underline underline-offset-4 decoration-[var(--color-cyan)]/40 hover:decoration-[var(--color-cyan)]"
              >
                RSS
              </Link>
            </span>
          }
        />

        {banner ? (
          <div
            role="status"
            className={`rounded-[8px] border text-[14px] ${BANNER_CLASS[banner]}`}
            style={{ margin: "24px 0", padding: "12px 16px" }}
          >
            {t(`status.${banner}`)}
            {banner === "confirmed" ? (
              <>
                {" "}
                <Link
                  href={`/${appLocale}/daily`}
                  className="underline underline-offset-4"
                >
                  {t("status.confirmedLink")}
                </Link>
              </>
            ) : null}
          </div>
        ) : null}

        <div className="max-w-[560px]" style={{ margin: "24px 0" }}>
          <SubscribeCard variant="full" />
        </div>

        <section className="max-w-[560px]" style={{ margin: "32px 0" }}>
          <h2
            className="font-mono uppercase text-[var(--fg-2)]"
            style={{
              fontSize: 13,
              letterSpacing: "0.08em",
              marginBottom: 14,
            }}
          >
            {t("explainer.title")}
          </h2>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <div className="text-[15px] text-[var(--color-fg)]">
                {t("explainer.digest.name")}
              </div>
              <p className="text-[13px] leading-relaxed text-[var(--fg-2)]">
                {t("explainer.digest.desc")}{" "}
                <Link
                  href={`/${appLocale}/daily`}
                  className="text-[var(--color-cyan,var(--accent-blue))] underline underline-offset-4 decoration-[currentColor]/40 hover:decoration-[currentColor]"
                >
                  {t("explainer.preview")}
                </Link>
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <div className="text-[15px] text-[var(--color-fg)]">
                {t("explainer.featured.name")}
              </div>
              <p className="text-[13px] leading-relaxed text-[var(--fg-2)]">
                {t("explainer.featured.desc")}
              </p>
            </div>
            <p className="text-[12.5px] text-[var(--fg-2)]">
              {t("explainer.time")}
            </p>
          </div>
        </section>
      </main>
    </ViewShell>
  );
}
