"use client";
import { useLocale } from "next-intl";
import { useTransition } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { Locale } from "@/i18n/routing";

const options: { value: Locale; label: string }[] = [
  { value: "zh", label: "中" },
  { value: "en", label: "EN" },
];

export function LocaleSwitcher() {
  const locale = useLocale() as Locale;
  const pathname = usePathname();
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
              startTransition(() => {
                router.replace(pathname, { locale: opt.value });
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
