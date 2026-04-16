import { useTranslations } from "next-intl";
import { Layers } from "lucide-react";

export function CrossSourceIndicator({ count }: { count: number }) {
  const t = useTranslations("story");
  return (
    <div className="flex items-center gap-1.5 pt-1 text-[12px] text-[var(--color-fg-dim)]">
      <Layers size={12} />
      <span>{t("crossSource", { count })}</span>
    </div>
  );
}
