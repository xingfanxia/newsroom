import { getTranslations, setRequestLocale } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";
import { sourcesByGroup } from "@/lib/sources/catalog";
import type { Source } from "@/lib/types";
import { ExternalLink, Rss } from "lucide-react";

type Locale = "zh" | "en";

export default async function SourcesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("sources");
  const tG = await getTranslations("sources.groups");
  const tC = await getTranslations("sources.cadence");

  const byGroup = sourcesByGroup();
  const groupOrder = [
    "vendor-official",
    "media",
    "newsletter",
    "research",
    "social",
    "product",
    "podcast",
    "policy",
    "market",
  ] as const;

  return (
    <>
      <header className="sticky top-0 z-20 border-b border-[var(--color-border-subtle)] bg-[var(--color-canvas)]/80 px-8 py-4 backdrop-blur-md">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-[590] tracking-[-0.56px] text-[var(--color-fg)]">
              {t("title")}
            </h1>
            <p className="mt-1 text-[14px] text-[var(--color-fg-muted)]">
              {t("subtitle")}
            </p>
          </div>
          <LocaleSwitcher />
        </div>
      </header>

      <div className="px-8 py-8">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-10">
          {groupOrder.map((g) => {
            const items = byGroup.get(g);
            if (!items || items.length === 0) return null;
            return (
              <section key={g}>
                <div className="mb-3 flex items-center gap-3">
                  <h2 className="text-[14px] font-[590] uppercase tracking-[0.12em] text-[var(--color-fg-muted)]">
                    {tG(g)}
                  </h2>
                  <span className="text-[12px] text-[var(--color-fg-dim)]">
                    {items.length}
                  </span>
                </div>
                <div className="surface-elevated overflow-hidden">
                  <table className="w-full border-separate border-spacing-0 text-[13.5px]">
                    <thead>
                      <tr className="bg-white/[0.02]">
                        <Th>{t("columns.name")}</Th>
                        <Th>{t("columns.kind")}</Th>
                        <Th>{t("columns.locale")}</Th>
                        <Th>{t("columns.cadence")}</Th>
                        <Th className="text-right pr-6">
                          {t("columns.priority")}
                        </Th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((s) => (
                        <SourceRow
                          key={s.id}
                          source={s}
                          locale={locale as Locale}
                          cadenceLabel={tC(s.cadence)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </>
  );
}

function Th({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`px-5 py-2.5 text-left font-[510] text-[12px] uppercase tracking-[0.06em] text-[var(--color-fg-dim)] border-b border-[var(--color-border-subtle)] ${className ?? ""}`}
    >
      {children}
    </th>
  );
}

function SourceRow({
  source,
  locale,
  cadenceLabel,
}: {
  source: Source;
  locale: Locale;
  cadenceLabel: string;
}) {
  return (
    <tr className="border-b border-[var(--color-border-subtle)] last:border-0 hover:bg-white/[0.02] transition-colors">
      <td className="px-5 py-3">
        <a
          href={source.url.startsWith("internal://") ? "#" : source.url}
          target="_blank"
          rel="noreferrer"
          className="group inline-flex items-center gap-2 font-[510] text-[var(--color-fg)] hover:text-[var(--color-cyan)] transition-colors"
        >
          <Rss
            size={13}
            className="text-[var(--color-fg-dim)] group-hover:text-[var(--color-cyan)] transition-colors"
          />
          <span>{source.name[locale === "zh" ? "zh" : "en"]}</span>
          {!source.url.startsWith("internal://") && (
            <ExternalLink
              size={11}
              className="text-[var(--color-fg-faint)] opacity-0 group-hover:opacity-100 transition-opacity"
            />
          )}
        </a>
        {source.notes && (
          <div className="mt-1 text-[12px] text-[var(--color-fg-dim)]">
            {source.notes}
          </div>
        )}
      </td>
      <td className="px-5 py-3 font-mono text-[12px] uppercase tabular text-[var(--color-fg-muted)]">
        {source.kind}
      </td>
      <td className="px-5 py-3 text-[12px] text-[var(--color-fg-muted)]">
        {source.locale}
      </td>
      <td className="px-5 py-3 text-[12px] text-[var(--color-fg-muted)]">
        {cadenceLabel}
      </td>
      <td className="px-5 py-3 pr-6 text-right">
        <Badge
          variant={
            source.priority === 1
              ? "cyan"
              : source.priority === 2
                ? "default"
                : "outline"
          }
        >
          P{source.priority}
        </Badge>
      </td>
    </tr>
  );
}
