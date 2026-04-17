"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Mail, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createSupabaseBrowser } from "@/lib/auth/supabase/client";

type Status = "idle" | "sending" | "sent" | "error";

/**
 * Magic-link login form. Hands off to Supabase `signInWithOtp` and shows a
 * "check your inbox" state on success. The caller injects the next-path so
 * we can round-trip back to the page that triggered the prompt.
 */
export function LoginForm({ next }: { next: string }) {
  const t = useTranslations("login");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorCode, setErrorCode] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus("sending");
    setErrorCode(null);

    const origin = window.location.origin;
    const redirectTo = `${origin}/api/auth/callback?next=${encodeURIComponent(next)}`;

    const supabase = createSupabaseBrowser();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirectTo },
    });

    if (error) {
      setErrorCode(error.message);
      setStatus("error");
      return;
    }
    setStatus("sent");
  }

  if (status === "sent") {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-[var(--color-border)] bg-white/[0.02] p-6 text-center">
        <Mail
          size={28}
          className="mx-auto text-[var(--color-cyan)]"
          aria-hidden
        />
        <h2 className="text-[17px] font-[590] text-[var(--color-fg)]">
          {t("sent.title")}
        </h2>
        <p className="text-[13.5px] leading-relaxed text-[var(--color-fg-muted)]">
          {t("sent.body", { email })}
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3"
      aria-busy={status === "sending"}
    >
      <label htmlFor="login-email" className="sr-only">
        {t("emailLabel")}
      </label>
      <Input
        id="login-email"
        type="email"
        required
        value={email}
        autoComplete="email"
        onChange={(e) => setEmail(e.target.value)}
        placeholder={t("emailPlaceholder")}
      />
      <Button
        type="submit"
        variant="primary"
        size="md"
        disabled={status === "sending" || !email.trim()}
      >
        {status === "sending" ? (
          <Loader2 size={14} className="animate-spin" aria-hidden />
        ) : null}
        {t("submit")}
      </Button>
      {status === "error" ? (
        <p
          role="alert"
          className="text-[12.5px] text-[var(--color-negative)]"
        >
          {t("error")} {errorCode ? `— ${errorCode}` : null}
        </p>
      ) : null}
    </form>
  );
}
