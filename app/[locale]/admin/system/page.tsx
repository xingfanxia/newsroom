import { getTranslations, setRequestLocale } from "next-intl/server";
import { ComingSoon } from "@/components/layout/coming-soon";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";

export default async function SystemPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("admin.system");
  return (
    <>
      <header className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-[var(--color-border-subtle)] bg-[var(--color-canvas)]/80 px-8 py-3.5 backdrop-blur-md">
        <h1 className="text-[15px] font-[510]">{t("title")}</h1>
        <LocaleSwitcher />
      </header>
      <ComingSoon title={t("title")} subtitle={t("subtitle")} />
    </>
  );
}
