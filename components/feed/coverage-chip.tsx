"use client";

import type { Story } from "@/lib/types";

type Props = {
  story: Story;
  showZh: boolean;
  onClick?: () => void;
};

/**
 * "由 N 信源报道" / "N sources" chip for multi-member event cards.
 *
 * Only rendered when coverage >= 2. Clicking it is expected to open the
 * signal drawer (wired up by the parent item.tsx). stopPropagation on click
 * so the click doesn't bubble to the card's expand toggle.
 */
export function CoverageChip({ story, showZh, onClick }: Props) {
  const coverage = story.coverage ?? 1;
  if (coverage < 2) return null;
  return (
    <button
      type="button"
      className="coverage-chip"
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      aria-label={
        showZh ? `由 ${coverage} 个信源报道` : `${coverage} sources cover this event`
      }
    >
      {showZh ? `📰 ${coverage} 信源` : `📰 ${coverage} sources`}
    </button>
  );
}
