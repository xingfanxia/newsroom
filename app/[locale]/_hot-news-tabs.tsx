"use client";
import { useState } from "react";
import { PillTabs } from "@/components/ui/tabs";

export function HotNewsTabsClient({
  labels,
}: {
  labels: { featured: string; all: string; p1: string };
}) {
  const [value, setValue] = useState<"featured" | "all" | "p1">("featured");
  return (
    <PillTabs
      items={[
        { value: "featured", label: labels.featured },
        { value: "all", label: labels.all },
        { value: "p1", label: labels.p1 },
      ]}
      value={value}
      onValueChange={(v) => setValue(v)}
    />
  );
}
