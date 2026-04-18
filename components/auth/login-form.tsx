"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Status = "idle" | "sending" | "error";

/**
 * Password-gate login form. POSTs to /api/admin/auth with the submitted
 * password; on success the server sets an httpOnly signed session cookie
 * and the client navigates to `next`. Errors render inline — we never
 * echo the password back or surface server-side stack traces.
 */
export function LoginForm({ next }: { next: string }) {
  const t = useTranslations("login");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorKey, setErrorKey] = useState<"invalid" | "server" | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password) return;
    setStatus("sending");
    setErrorKey(null);

    try {
      const res = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, next }),
      });
      if (res.status === 401) {
        setStatus("error");
        setErrorKey("invalid");
        return;
      }
      if (!res.ok) {
        setStatus("error");
        setErrorKey("server");
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { next?: string };
      const target = body.next || next;
      // Full reload rather than router.push so the freshly-set cookie is
      // seen by the proxy before the admin page renders.
      window.location.assign(target);
    } catch {
      setStatus("error");
      setErrorKey("server");
    }
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3"
      aria-busy={status === "sending"}
    >
      <label htmlFor="login-password" className="sr-only">
        {t("passwordLabel")}
      </label>
      <Input
        id="login-password"
        type="password"
        required
        value={password}
        autoComplete="current-password"
        onChange={(e) => setPassword(e.target.value)}
        placeholder={t("passwordPlaceholder")}
      />
      <Button
        type="submit"
        variant="primary"
        size="md"
        disabled={status === "sending" || !password}
      >
        {status === "sending" ? (
          <Loader2 size={14} className="animate-spin" aria-hidden />
        ) : null}
        {t("submit")}
      </Button>
      {status === "error" && errorKey ? (
        <p
          role="alert"
          className="text-[12.5px] text-[var(--color-negative)]"
        >
          {t(errorKey === "invalid" ? "errors.invalid" : "errors.server")}
        </p>
      ) : null}
    </form>
  );
}
