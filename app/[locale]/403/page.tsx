import { getTranslations, setRequestLocale } from "next-intl/server";
import { ShieldOff } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { createSupabaseServer } from "@/lib/auth/supabase/server";

export const dynamic = "force-dynamic";

/**
 * 403 landing for authenticated-but-not-admin users who tried to open an
 * /:locale/admin/* path. We surface the signed-in email so the user knows
 * which account hit the gate — useful when they have multiple Google logins.
 */
export default async function ForbiddenPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("forbidden");

  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const email = user?.email ?? "(unknown)";

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 py-10">
      <div className="w-full max-w-[440px] rounded-xl border border-[var(--color-border)] bg-white/[0.02] p-7 text-center">
        <ShieldOff
          size={30}
          className="mx-auto mb-4 text-[var(--color-warning)]"
          aria-hidden
        />
        <h1 className="text-[20px] font-[590] tracking-[-0.32px] text-[var(--color-fg)]">
          {t("title")}
        </h1>
        <p className="mt-3 text-[13.5px] leading-relaxed text-[var(--color-fg-muted)]">
          {t("body", { email })}
        </p>

        <Link
          href={"/" as const}
          className="mt-5 inline-flex h-9 items-center gap-2 rounded-md border border-[var(--color-border)] bg-white/[0.02] px-4 text-[13.5px] font-[510] text-[var(--color-fg)] transition-colors hover:bg-white/[0.04]"
        >
          {t("backHome")}
        </Link>
      </div>
    </div>
  );
}
