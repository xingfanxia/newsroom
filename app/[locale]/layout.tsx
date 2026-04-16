import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { JetBrains_Mono } from "next/font/google";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { notFound } from "next/navigation";
import { getMessages, setRequestLocale } from "next-intl/server";
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
  title: "AI·HOT — AI newsroom",
  description:
    "AI-native bilingual news intelligence dashboard with self-iterating editorial agent.",
  icons: {
    icon: "/favicon.svg",
  },
};

// Dashboard — render on-demand, skip static prerender
export const dynamic = "force-dynamic";

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
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
