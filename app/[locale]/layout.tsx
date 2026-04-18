import type { Metadata } from "next";
import { JetBrains_Mono, Noto_Sans_SC, Noto_Serif_SC } from "next/font/google";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { notFound } from "next/navigation";
import { getMessages, setRequestLocale } from "next-intl/server";
import { Toaster } from "sonner";
import { routing } from "@/i18n/routing";
import "../globals.css";
import "../terminal.css";

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

const notoSans = Noto_Sans_SC({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-noto-sans",
  display: "swap",
});

const notoSerif = Noto_Serif_SC({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-noto-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ax radar — AI intelligence",
  description:
    "Terminal-forward AI intelligence radar. Fifty-plus sources in, curated signal out. Bilingual.",
  icons: { icon: "/favicon.svg" },
  alternates: {
    types: {
      "application/rss+xml": [
        { url: "/api/feed/en/rss.xml", title: "AX's AI RADAR (English)" },
        { url: "/api/feed/zh/rss.xml", title: "AX 的 AI 雷达 (中文)" },
      ],
    },
  },
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const messages = await getMessages();

  // Default tweak state is echoed onto body data-* attributes so SSR paints the
  // right palette on first byte. The Tweaks client later mutates these.
  return (
    <html
      lang={locale}
      className={`${jetbrains.variable} ${notoSans.variable} ${notoSerif.variable}`}
    >
      <body
        data-theme="midnight"
        data-accent="green"
        data-mono="jetbrains"
        data-cjk="notoSerif"
        data-radius="sharp"
        data-chrome="terminal"
        data-score="ring"
        data-density="compact"
        data-linenum="off"
        data-mutedmeta="on"
        data-lang={locale}
      >
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
          <Toaster
            theme="dark"
            position="bottom-right"
            toastOptions={{
              classNames: {
                toast:
                  "!bg-[var(--bg-1)] !border !border-[var(--border-1)] !text-[var(--fg-0)]",
                actionButton:
                  "!bg-[var(--accent-green)] !text-[var(--bg-0)]",
              },
            }}
          />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
