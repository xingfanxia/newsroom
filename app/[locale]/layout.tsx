import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { JetBrains_Mono } from "next/font/google";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { notFound } from "next/navigation";
import { getMessages, setRequestLocale } from "next-intl/server";
import { Toaster } from "sonner";
import { routing } from "@/i18n/routing";
import { Sidebar } from "@/components/layout/sidebar";
import "../globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AX's AI RADAR — AI intelligence radar",
  description:
    "Bilingual AI intelligence radar with a self-iterating editorial agent. Fifty-plus sources in, curated signal out.",
  icons: {
    icon: "/favicon.svg",
  },
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

  return (
    <html lang={locale} className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <div className="relative z-[1] flex min-h-dvh">
            <Sidebar />
            <main className="flex min-h-dvh flex-1 flex-col">{children}</main>
          </div>
          <Toaster
            theme="dark"
            position="bottom-right"
            toastOptions={{
              classNames: {
                toast:
                  "!bg-[var(--color-panel)] !border !border-[var(--color-border)] !text-[var(--color-fg)]",
                actionButton:
                  "!bg-[var(--color-cyan)] !text-[var(--color-canvas)]",
              },
            }}
          />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
