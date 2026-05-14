import type { MetadataRoute } from "next";

const SITE_URL = "https://news.ax0x.ai";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: [
          "/",
          "/skill.md",
          "/openapi.yaml",
          "/api/public/",
          "/api/rss/",
          "/api/feed/",
          "/api/events/",
        ],
        disallow: [
          "/admin",
          "/zh/admin",
          "/en/admin",
          "/api/admin/",
          "/api/cron/",
          "/api/v1/",
          "/api/mcp",
          "/api/feedback",
          "/api/saved",
          "/api/tweaks",
          "/login",
          "/zh/login",
          "/en/login",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
