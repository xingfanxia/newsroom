"use client";
import { ThumbsUp, ThumbsDown, Star } from "lucide-react";
import { useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type UserVotes = { up: boolean; down: boolean; save: boolean };
type Vote = keyof UserVotes;

/**
 * 👍 / 👎 / ⭐ toggle row. Optimistically flips local state, POSTs to
 * /api/feedback, and reconciles with the server's response. On 401 the UI
 * reverts the flip, surfaces a "sign in to vote" toast, and offers a link
 * to /login?next=… for the current page.
 *
 * `storyId` is the Story.id (numeric, stringified by the feed query). We
 * parse it back to an int before sending — the API's zod schema rejects
 * non-integer values, so invalid ids surface as a build/runtime error
 * rather than silently no-op'ing.
 */
export function FeedbackControls({
  storyId,
  initial,
}: {
  storyId: string;
  initial?: UserVotes;
}) {
  const t = useTranslations("story");
  const tf = useTranslations("feedback");
  const locale = useLocale();
  const router = useRouter();
  const [state, setState] = useState<UserVotes>(
    initial ?? { up: false, down: false, save: false },
  );
  const [pending, startTransition] = useTransition();

  const itemId = Number.parseInt(storyId, 10);

  async function toggle(vote: Vote) {
    if (pending || !Number.isInteger(itemId) || itemId <= 0) return;

    const wasOn = state[vote];
    const nextOn = !wasOn;

    // Optimistic — mirror the server's mutual-exclusion rule client-side so
    // the UI doesn't flicker while the request is in flight.
    setState((prev) => {
      const next = { ...prev, [vote]: nextOn };
      if (nextOn && vote === "up") next.down = false;
      if (nextOn && vote === "down") next.up = false;
      return next;
    });

    startTransition(async () => {
      try {
        const res = await fetch("/api/feedback", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ itemId, vote, on: nextOn }),
        });

        if (res.status === 401) {
          // Revert the optimistic flip, then hand the user off to login.
          setState((prev) => ({ ...prev, [vote]: wasOn }));
          const nextPath =
            typeof window === "undefined"
              ? `/${locale}`
              : window.location.pathname + window.location.search;
          toast(tf("signInPrompt"), {
            action: {
              label: tf("signInPrompt"),
              onClick: () =>
                router.push(
                  `/login?next=${encodeURIComponent(nextPath)}` as "/",
                ),
            },
          });
          return;
        }

        if (!res.ok) {
          throw new Error(`feedback_http_${res.status}`);
        }

        const body = (await res.json()) as {
          ok: boolean;
          userVotes: UserVotes;
        };
        if (body?.userVotes) setState(body.userVotes);
      } catch (err) {
        // Revert — the optimistic flip was wrong.
        setState((prev) => ({ ...prev, [vote]: wasOn }));
        console.error("[feedback-controls] toggle failed", err);
      }
    });
  }

  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        onClick={() => toggle("up")}
        title={t("thumbsUp")}
        aria-pressed={state.up}
        disabled={pending}
        className={cn(
          "grid size-7 place-items-center rounded-md transition-colors",
          state.up
            ? "text-[var(--color-positive)]"
            : "text-[var(--color-fg-dim)] hover:bg-white/[0.05] hover:text-[var(--color-positive)]",
        )}
      >
        <ThumbsUp size={15} />
      </button>
      <button
        type="button"
        onClick={() => toggle("down")}
        title={t("thumbsDown")}
        aria-pressed={state.down}
        disabled={pending}
        className={cn(
          "grid size-7 place-items-center rounded-md transition-colors",
          state.down
            ? "text-[var(--color-negative)]"
            : "text-[var(--color-fg-dim)] hover:bg-white/[0.05] hover:text-[var(--color-negative)]",
        )}
      >
        <ThumbsDown size={15} />
      </button>
      <button
        type="button"
        onClick={() => toggle("save")}
        title={t("bookmark")}
        aria-pressed={state.save}
        disabled={pending}
        className={cn(
          "grid size-7 place-items-center rounded-md transition-colors",
          state.save
            ? "text-[var(--color-warning)]"
            : "text-[var(--color-fg-dim)] hover:bg-white/[0.05] hover:text-[var(--color-warning)]",
        )}
      >
        <Star size={15} fill={state.save ? "currentColor" : "none"} />
      </button>
    </div>
  );
}
