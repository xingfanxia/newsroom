"use client";
import { ThumbsUp, ThumbsDown, Star } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

type State = "none" | "up" | "down";

export function FeedbackControls({ initial = "none" }: { initial?: State }) {
  const t = useTranslations("story");
  const [state, setState] = useState<State>(initial);
  const [saved, setSaved] = useState(false);

  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        onClick={() => setState((s) => (s === "up" ? "none" : "up"))}
        title={t("thumbsUp")}
        aria-pressed={state === "up"}
        className={cn(
          "grid size-7 place-items-center rounded-md transition-colors",
          state === "up"
            ? "text-[var(--color-positive)]"
            : "text-[var(--color-fg-dim)] hover:bg-white/[0.05] hover:text-[var(--color-positive)]",
        )}
      >
        <ThumbsUp size={15} />
      </button>
      <button
        type="button"
        onClick={() => setState((s) => (s === "down" ? "none" : "down"))}
        title={t("thumbsDown")}
        aria-pressed={state === "down"}
        className={cn(
          "grid size-7 place-items-center rounded-md transition-colors",
          state === "down"
            ? "text-[var(--color-negative)]"
            : "text-[var(--color-fg-dim)] hover:bg-white/[0.05] hover:text-[var(--color-negative)]",
        )}
      >
        <ThumbsDown size={15} />
      </button>
      <button
        type="button"
        onClick={() => setSaved((v) => !v)}
        title={t("bookmark")}
        aria-pressed={saved}
        className={cn(
          "grid size-7 place-items-center rounded-md transition-colors",
          saved
            ? "text-[var(--color-warning)]"
            : "text-[var(--color-fg-dim)] hover:bg-white/[0.05] hover:text-[var(--color-warning)]",
        )}
      >
        <Star size={15} fill={saved ? "currentColor" : "none"} />
      </button>
    </div>
  );
}
