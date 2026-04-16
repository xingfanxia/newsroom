import { getTranslations, setRequestLocale } from "next-intl/server";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";
import { SourceRow } from "@/components/sources/source-row";
import { getLiveSources, liveSourcesByGroup } from "@/lib/sources/live";

export const dynamic = "force-dynamic";

const GROUP_ORDER = [
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

  const live = await getLiveSources();
  const totalItems = live.reduce((a, b) => a + b.health.totalItemsCount, 0);
  const okCount = live.filter((s) => s.health.status === "ok").length;
  const errorCount = live.filter((s) => s.health.status === "error").length;
  const byGroup = liveSourcesByGroup(live);

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

        <div className="mt-4 flex flex-wrap items-center gap-4 font-mono text-[12px] tabular text-[var(--color-fg-muted)]">
          <span>
            <span className="text-[var(--color-fg)]">{live.length}</span> sources
          </span>
          <span className="text-[var(--color-fg-faint)]">·</span>
          <span>
            <span className="text-[var(--color-positive)]">{okCount}</span> ok
          </span>
          <span className="text-[var(--color-fg-faint)]">·</span>
          <span>
            <span className="text-[var(--color-negative)]">{errorCount}</span> error
          </span>
          <span className="text-[var(--color-fg-faint)]">·</span>
          <span>
            <span className="text-[var(--color-cyan)]">
              {totalItems.toLocaleString(locale === "zh" ? "zh-CN" : "en-US")}
            </span>{" "}
            items collected
          </span>
        </div>
      </header>

      <div className="px-8 py-8">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-10">
          {GROUP_ORDER.map((g) => {
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
                        <Th className="text-right">
                          {locale === "zh" ? "累计" : "Items"}
                        </Th>
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
                          locale={locale as "zh" | "en"}
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
