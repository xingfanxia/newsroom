import { getTranslations, setRequestLocale } from "next-intl/server";
import { LoginForm } from "@/components/auth/login-form";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";
import { Logo } from "@/components/layout/logo";

export const dynamic = "force-dynamic";

type SearchParams = {
  next?: string | string[];
  error?: string | string[];
};

/**
 * /login page. Magic-link form — the only way into the app for now.
 *
 * `?next=...` is forwarded to the callback so after a successful exchange
 * we land the user back on the page that sent them here. `?error=...` is
 * surfaced from a failed callback (e.g. stale code).
 */
export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  const { next, error } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("login");

  const nextPath = sanitizeNext(Array.isArray(next) ? next[0] : next, locale);
  const errorCode = Array.isArray(error) ? error[0] : error;

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 py-10">
      <div className="absolute right-6 top-6">
        <LocaleSwitcher />
      </div>

      <div className="w-full max-w-[380px]">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <Logo />
          <h1 className="text-[22px] font-[590] tracking-[-0.44px] text-[var(--color-fg)]">
            {t("title")}
          </h1>
          <p className="text-[13.5px] leading-relaxed text-[var(--color-fg-muted)]">
            {t("subtitle")}
          </p>
        </div>

        <LoginForm next={nextPath} />

        {errorCode ? (
          <p
            role="alert"
            className="mt-4 text-center text-[12.5px] text-[var(--color-negative)]"
          >
            {t(errorMessageKey(errorCode))}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function sanitizeNext(raw: string | undefined, locale: string): string {
  if (!raw) return `/${locale}`;
  if (!raw.startsWith("/") || raw.startsWith("//")) return `/${locale}`;
  if (raw.startsWith("/api")) return `/${locale}`;
  return raw;
}

const KNOWN_ERROR_CODES = new Set(["missing_code", "callback_failed"]);
function errorMessageKey(code: string): string {
  return KNOWN_ERROR_CODES.has(code) ? `errors.${code}` : "errors.fallback";
}
