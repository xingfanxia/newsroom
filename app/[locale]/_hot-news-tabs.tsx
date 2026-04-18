"use client";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { PillTabs } from "@/components/ui/tabs";

/** Hot News' tier filter. "all" is now its own sidebar route (/all) — this
 *  view focuses on the curated subsets. */
type Tier = "featured" | "p1";

export function HotNewsTabsClient({
  labels,
  tier,
}: {
  labels: { featured: string; p1: string };
  tier: Tier;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function setTier(next: Tier) {
    const params = new URLSearchParams(searchParams);
    if (next === "featured") {
      params.delete("tier");
    } else {
      params.set("tier", next);
    }
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname);
    });
  }

  return (
    <div style={{ opacity: pending ? 0.6 : 1 }}>
      <PillTabs
        items={[
          { value: "featured", label: labels.featured },
          { value: "p1", label: labels.p1 },
        ]}
        value={tier}
        onValueChange={(v) => setTier(v)}
      />
    </div>
  );
}
