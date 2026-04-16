import { getTranslations, setRequestLocale } from "next-intl/server";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";
import { VersionPill } from "@/components/admin/version-pill";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";

async function loadPolicy() {
  try {
    return await readFile(
      path.join(
        process.cwd(),
        "modules/feed/runtime/policy/skills/editorial.skill.md",
      ),
      "utf8",
    );
  } catch {
    return "editorial.skill.md not found.";
  }
}

export default async function PolicyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("admin.policy");
  const policyBody = await loadPolicy();

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
            <VersionPill version="v3" />
          </div>
          <pre className="surface-elevated overflow-x-auto p-6 font-mono text-[13px] leading-[1.7] text-[var(--color-fg-muted)] whitespace-pre-wrap">
            {policyBody}
          </pre>
        </div>
      </div>
    </>
  );
}
