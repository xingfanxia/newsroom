"use client";
import { useLocale } from "next-intl";
import { useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { usePathname, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { APP_LOCALES } from "@/lib/types";
import type { Locale } from "@/i18n/routing";

const LOCALE_SWITCHER_LABELS = {
  zh: "中",
  en: "EN",
} satisfies Record<Locale, string>;

const options: { value: Locale; label: string }[] = APP_LOCALES.map(
  (value) => ({ value, label: LOCALE_SWITCHER_LABELS[value] }),
);

export function LocaleSwitcher() {
  const locale = useLocale() as Locale;
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full border border-[var(--color-border-subtle)] bg-white/[0.02] p-0.5 font-[510]",
        pending && "opacity-60",
      )}
      aria-label="locale switcher"
    >
      {options.map((opt) => {
        const active = opt.value === locale;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => {
              if (active) return;
              // Preserve the active feed filters (query string) across the
              // locale switch — a bare pathname replace would drop them.
              const query = Object.fromEntries(searchParams.entries());
              startTransition(() => {
                router.replace({ pathname, query }, { locale: opt.value });
              });
            }}
            className={cn(
              "h-7 min-w-[34px] px-2 rounded-full text-[12px] tracking-wider transition-all",
              active
                ? "bg-[rgba(62,230,230,0.12)] text-[var(--color-cyan)] shadow-[inset_0_0_0_1px_rgba(62,230,230,0.3)]"
                : "text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
