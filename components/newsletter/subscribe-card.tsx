"use client";
import { useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Status = "idle" | "sending" | "success" | "error";
type ErrorKey = "invalid" | "rate" | "server";

/**
 * Newsletter double-opt-in signup (PLAN.md §5b).
 * `full` — /newsletter page: terminal-prompt header, kind checkboxes.
 * `inline` — daily index embed: single email+button row, links to
 * /newsletter for preferences.
 * Success deliberately replaces the form (no resubmit temptation) and
 * shows the exact next step: go click the confirm link.
 *
 * Spacing note: margins/paddings are inline styles, not Tailwind
 * utilities — globals.css has an unlayered `*{margin:0;padding:0}`
 * reset that beats every layered spacing utility (repo-wide).
 */
export function SubscribeCard({ variant }: { variant: "full" | "inline" }) {
  const t = useTranslations("newsletter");
  const locale = useLocale();
  const [email, setEmail] = useState("");
  const [wantsDigest, setWantsDigest] = useState(true);
  const [wantsFeatured, setWantsFeatured] = useState(true);
  const [status, setStatus] = useState<Status>("idle");
  const [errorKey, setErrorKey] = useState<ErrorKey | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || status === "sending") return;
    setStatus("sending");
    setErrorKey(null);
    try {
      const res = await fetch("/api/newsletter/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          locale,
          wantsDailyDigest: variant === "full" ? wantsDigest : true,
          wantsDailyFeatured: variant === "full" ? wantsFeatured : true,
        }),
      });
      if (res.status === 400) {
        setStatus("error");
        setErrorKey("invalid");
        return;
      }
      if (res.status === 429) {
        setStatus("error");
        setErrorKey("rate");
        return;
      }
      if (!res.ok) {
        setStatus("error");
        setErrorKey("server");
        return;
      }
      setStatus("success");
    } catch {
      setStatus("error");
      setErrorKey("server");
    }
  }

  const errorLine =
    status === "error" && errorKey ? (
      <p
        role="alert"
        className="text-[12.5px] text-[var(--color-negative)]"
        style={{ marginTop: 10 }}
      >
        {t(`errors.${errorKey}`)}
      </p>
    ) : null;

  if (status === "success") {
    return (
      <div
        role="status"
        className={
          variant === "full"
            ? "rounded-[10px] border border-[var(--color-border)] bg-white/[0.02]"
            : undefined
        }
        style={variant === "full" ? { padding: 20 } : { margin: "16px 0" }}
      >
        <p className="text-[15px] text-[var(--color-fg)]">
          {t("success.title")} 📬
        </p>
        <p className="text-[13px] text-[var(--fg-2)]" style={{ marginTop: 4 }}>
          {t("success.body", { email })}
        </p>
      </div>
    );
  }

  if (variant === "inline") {
    return (
      <form
        onSubmit={submit}
        aria-busy={status === "sending"}
        style={{ margin: "16px 0" }}
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label htmlFor="newsletter-email-inline" className="sr-only">
            {t("emailLabel")}
          </label>
          <Input
            id="newsletter-email-inline"
            type="email"
            required
            autoComplete="email"
            value={email}
            disabled={status === "sending"}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("emailPlaceholder")}
            className="sm:max-w-[320px]"
            style={{ padding: "0 14px" }}
          />
          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={status === "sending" || !email}
            style={{ minHeight: 44, padding: "0 20px" }}
          >
            {status === "sending" ? (
              <Loader2 size={14} className="animate-spin" aria-hidden />
            ) : null}
            {t("submitInline")}
          </Button>
        </div>
        <p className="text-[12px] text-[var(--fg-2)]" style={{ marginTop: 6 }}>
          {t("inlineCaption")}{" "}
          <Link
            href={`/${locale}/newsletter`}
            className="text-[var(--color-cyan,var(--accent-blue))] underline underline-offset-4 decoration-[currentColor]/40 hover:decoration-[currentColor]"
          >
            {t("inlineMore")}
          </Link>
        </p>
        {errorLine}
      </form>
    );
  }

  return (
    <form
      onSubmit={submit}
      aria-busy={status === "sending"}
      className="rounded-[10px] border border-[var(--color-border)] bg-white/[0.02]"
      style={{ padding: 20 }}
    >
      <div
        className="font-mono text-[13px] text-[var(--accent-green,#3fb950)]"
        style={{ marginBottom: 14 }}
      >
        $ subscribe --daily
      </div>
      <label htmlFor="newsletter-email" className="sr-only">
        {t("emailLabel")}
      </label>
      <Input
        id="newsletter-email"
        type="email"
        required
        autoComplete="email"
        value={email}
        disabled={status === "sending"}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={t("emailPlaceholder")}
        style={{ padding: "0 14px" }}
      />
      <fieldset
        className="flex flex-col gap-3 border-0"
        style={{ marginTop: 16 }}
      >
        <legend className="sr-only">{t("kinds.legend")}</legend>
        <label className="flex cursor-pointer items-start gap-3" style={{ minHeight: 44 }}>
          <input
            type="checkbox"
            checked={wantsDigest}
            disabled={status === "sending"}
            onChange={(e) => setWantsDigest(e.target.checked)}
            className="h-4 w-4 accent-[var(--accent-green,#3fb950)]"
            style={{ marginTop: 3 }}
          />
          <span>
            <span className="block text-[14px] text-[var(--color-fg)]">
              {t("kinds.digest.label")}
            </span>
            <span className="block text-[12.5px] text-[var(--fg-2)]">
              {t("kinds.digest.desc")}
            </span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-3" style={{ minHeight: 44 }}>
          <input
            type="checkbox"
            checked={wantsFeatured}
            disabled={status === "sending"}
            onChange={(e) => setWantsFeatured(e.target.checked)}
            className="h-4 w-4 accent-[var(--accent-green,#3fb950)]"
            style={{ marginTop: 3 }}
          />
          <span>
            <span className="block text-[14px] text-[var(--color-fg)]">
              {t("kinds.featured.label")}
            </span>
            <span className="block text-[12.5px] text-[var(--fg-2)]">
              {t("kinds.featured.desc")}
            </span>
          </span>
        </label>
      </fieldset>
      <Button
        type="submit"
        variant="primary"
        size="md"
        disabled={status === "sending" || !email || (!wantsDigest && !wantsFeatured)}
        className="w-full"
        style={{ marginTop: 16, minHeight: 44 }}
      >
        {status === "sending" ? (
          <Loader2 size={14} className="animate-spin" aria-hidden />
        ) : null}
        {t("submit")}
      </Button>
      {errorLine}
    </form>
  );
}
