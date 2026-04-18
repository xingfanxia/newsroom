import { getTranslations, setRequestLocale } from "next-intl/server";
import { LoginForm } from "@/components/auth/login-form";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";
import { Logo } from "@/components/layout/logo";

export const dynamic = "force-dynamic";

type SearchParams = {
  next?: string | string[];
};

/**
 * /login — password-gated entry. `?next=` is forwarded to the auth endpoint
 * so a signed-in admin lands back on the page that redirected them here
 * (e.g. /zh/admin/iterations).
 */
export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  const { next } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("login");

  const nextPath = sanitizeNext(Array.isArray(next) ? next[0] : next, locale);

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
      </div>
    </div>
  );
}

/** Restrict `?next=` to same-origin rooted paths; block open-redirects. */
function sanitizeNext(raw: string | undefined, locale: string): string {
  if (!raw) return `/${locale}`;
  if (!raw.startsWith("/") || raw.startsWith("//")) return `/${locale}`;
  if (raw.startsWith("/api")) return `/${locale}`;
  return raw;
}
