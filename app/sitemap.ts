/**
 * Sitemap — Next.js App Router metadata file.
 *
 * Covers the static + locale-scoped routes. Dynamic daily-column dates
 * (/zh/daily/[date]) are intentionally omitted from the first pass — they
 * grow ~1/day and the index page at /zh/daily already links them. Add a
 * dynamic enumerator here when SEO traction justifies the cost.
 */
import type { MetadataRoute } from "next";
import { publicUrl } from "@/lib/site";
import { APP_LOCALES } from "@/lib/types";

const PRIMARY_ROUTES = [
  "",          // /[locale]
  "/agents",
  "/daily",
  "/curated",
  "/podcasts",
  "/all",
  "/sources",
  "/saved",
  "/x-monitor",
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const localePages: MetadataRoute.Sitemap = APP_LOCALES.flatMap((locale) =>
    PRIMARY_ROUTES.map((route) => ({
      url: publicUrl(`/${locale}${route}`),
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
      url: publicUrl("/skill.md"),
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.8,
    },
    {
      url: publicUrl("/openapi.yaml"),
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    },
  ];
}
