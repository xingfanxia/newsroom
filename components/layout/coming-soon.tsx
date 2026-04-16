import { useTranslations } from "next-intl";
import { Construction } from "lucide-react";

export function ComingSoon({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  const t = useTranslations("common");
  return (
    <div className="flex flex-1 items-center justify-center px-8 py-16">
      <div className="surface-featured max-w-[520px] px-10 py-12 text-center">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-[rgba(62,230,230,0.1)] text-[var(--color-cyan)]">
          <Construction size={20} />
        </div>
        <h1 className="text-[22px] font-[590] tracking-tight text-[var(--color-fg)]">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-2 text-[14px] leading-relaxed text-[var(--color-fg-muted)]">
            {subtitle}
          </p>
        )}
        <p className="mt-5 text-[12.5px] font-[510] uppercase tracking-[0.14em] text-[var(--color-cyan)]">
          {t("comingSoon")}
        </p>
        <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-fg-dim)]">
          {t("comingSoonDescription")}
        </p>
      </div>
    </div>
  );
}
