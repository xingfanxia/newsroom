/**
 * Sitemap — Next.js App Router metadata file.
 *
 * Covers the static + locale-scoped routes. Dynamic daily-column dates
 * (/zh/daily/[date]) are intentionally omitted from the first pass — they
 * grow ~1/day and the index page at /zh/daily already links them. Add a
 * dynamic enumerator here when SEO traction justifies the cost.
 */
import type { MetadataRoute } from "next";

const SITE_URL = "https://news.ax0x.ai";

const LOCALES = ["zh", "en"] as const;

const PRIMARY_ROUTES = [
  "",          // /[locale]
  "/agents",
  "/daily",
  "/curated",
  "/papers",
  "/podcasts",
  "/all",
  "/sources",
  "/saved",
  "/x-monitor",
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const localePages: MetadataRoute.Sitemap = LOCALES.flatMap((locale) =>
    PRIMARY_ROUTES.map((route) => ({
      url: `${SITE_URL}/${locale}${route}`,
      lastModified: now,
      changeFrequency:
        route === ""
          ? ("hourly" as const)
          : route === "/daily" || route === "/curated"
            ? ("daily" as const)
            : ("weekly" as const),
      priority:
        route === ""
          ? 1.0
          : route === "/agents" || route === "/daily"
            ? 0.9
            : 0.6,
    })),
  );

  return [
    ...localePages,
    {
      url: `${SITE_URL}/skill.md`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/openapi.yaml`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    },
  ];
}
