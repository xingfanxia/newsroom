"use client";
import { useState } from "react";
import { ChevronDown, ChevronRight, FileText } from "lucide-react";
import { useTranslations } from "next-intl";
import { Prose } from "@/components/markdown/prose";

/**
 * Collapsible transcript panel for podcast / video detail pages. Defaults to
 * collapsed — transcripts are 6-15K characters and push the deep-take out of
 * view when rendered eagerly.
 *
 * When expanded we render through <Prose/> so Jina-reader markdown (headings,
 * bullets from article versions) gets typographic treatment; YouTube captions
 * that arrive as plaintext still render fine since react-markdown passes
 * unformatted text through as a paragraph.
 */
export function Transcript({ bodyMd }: { bodyMd: string | null }) {
  const t = useTranslations("podcasts.detail");
  const [open, setOpen] = useState(false);

  if (!bodyMd) {
    return (
      <section className="rounded-xl border border-[var(--color-border)] bg-white/[0.02] px-6 py-5">
        <div className="flex items-center gap-2 text-[13.5px] text-[var(--color-fg-dim)]">
          <FileText size={14} className="text-[var(--color-fg-faint)]" />
          <span>{t("noTranscript")}</span>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-white/[0.02]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-6 py-4 text-left text-[14.5px] font-[510] text-[var(--color-fg)] transition-colors hover:bg-white/[0.02]"
      >
        <span className="flex items-center gap-2">
          <FileText size={14} className="text-[var(--color-cyan)]" />
          {t("transcript")}
          <span className="text-[12px] font-[400] text-[var(--color-fg-dim)]">
            {t("transcriptLen", { chars: bodyMd.length })}
          </span>
        </span>
        {open ? (
          <ChevronDown size={16} className="text-[var(--color-fg-dim)]" />
        ) : (
          <ChevronRight size={16} className="text-[var(--color-fg-dim)]" />
        )}
      </button>

      {open ? (
        <div className="border-t border-[var(--color-border-subtle)] px-6 py-5">
          <div className="max-h-[640px] overflow-y-auto pr-3">
            <Prose>{bodyMd}</Prose>
          </div>
        </div>
      ) : null}
    </section>
  );
}
