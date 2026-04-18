import { getTranslations, setRequestLocale } from "next-intl/server";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";
import { VersionPill } from "@/components/admin/version-pill";
import { getActiveSkill } from "@/lib/policy/skill";

export const dynamic = "force-dynamic";

export default async function PolicyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("admin.policy");

  let skill: Awaited<ReturnType<typeof getActiveSkill>> | null = null;
  let error: string | null = null;
  try {
    skill = await getActiveSkill("editorial");
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  return (
    <>
      <header className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-[var(--color-border-subtle)] bg-[var(--color-canvas)]/80 px-8 py-3.5 backdrop-blur-md">
        <h1 className="text-[15px] font-[510]">{t("title")}</h1>
        <LocaleSwitcher />
      </header>
      <div className="px-8 py-8">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-[24px] font-[590] tracking-[-0.288px] text-[var(--color-fg)]">
                {t("title")}
              </h2>
              <p className="mt-1 text-[14px] text-[var(--color-fg-muted)]">
                {t("subtitle")}
              </p>
            </div>
            {skill ? <VersionPill version={`v${skill.version}`} /> : null}
          </div>
          <pre className="surface-elevated overflow-x-auto p-6 font-mono text-[13px] leading-[1.7] text-[var(--color-fg-muted)] whitespace-pre-wrap">
            {skill?.content ?? error ?? "editorial.skill.md not found."}
          </pre>
        </div>
      </div>
    </>
  );
}
