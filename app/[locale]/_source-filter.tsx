"use client";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { PillTabs } from "@/components/ui/tabs";

/** Presets map to (group, kind) filters in lib/items/live.ts. Keep the label
 *  set short — pill row wraps on narrow widths but large menus overwhelm. */
export type SourcePreset =
  | "all"
  | "official"
  | "newsletter"
  | "media"
  | "x"
  | "research";

const PRESETS: SourcePreset[] = [
  "all",
  "official",
  "newsletter",
  "media",
  "x",
  "research",
];

export function SourceFilterClient({
  value,
  labels,
}: {
  value: SourcePreset;
  labels: Record<SourcePreset, string>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function setFilter(next: SourcePreset) {
    const params = new URLSearchParams(searchParams);
    if (next === "all") {
      params.delete("source");
    } else {
      params.set("source", next);
    }
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname);
    });
  }

  return (
    <div style={{ opacity: pending ? 0.6 : 1 }}>
      <PillTabs
        items={PRESETS.map((p) => ({ value: p, label: labels[p] }))}
        value={value}
        onValueChange={(v) => setFilter(v)}
      />
    </div>
  );
}
