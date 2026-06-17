import { setRequestLocale } from "next-intl/server";
import { ViewShell } from "@/components/shell/view-shell";
import { PageHead } from "@/components/shell/page-head";
import { ComingSoonPanel } from "@/components/shell/coming-soon-panel";
import { getShellChromeData } from "@/lib/shell/chrome-data";

// Admin pages render per-request — they read live stats and contain client
// components (ViewShell tree) that call useSearchParams. Static prerender
// would require a Suspense boundary; for an admin-only route we just opt
// out of static generation instead.
export const dynamic = "force-dynamic";

export default async function UsersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const chrome = await getShellChromeData();

  return (
    <ViewShell
      locale={locale as "en" | "zh"}
      stats={chrome.topBarStats}
      crumb="~/admin/users"
      cmd="cat /etc/passwd"
    >
      <main className="main">
        <PageHead en="users" cjk="用户" />
        <ComingSoonPanel en="user management" cjk="用户管理" />
      </main>
    </ViewShell>
  );
}
