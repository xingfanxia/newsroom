import type { MetadataRoute } from "next";
import { PUBLIC_SITE_URL, publicUrl } from "@/lib/site";

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
          "/saved",
          "/zh/saved",
          "/en/saved",
        ],
      },
    ],
    sitemap: publicUrl("/sitemap.xml"),
    host: PUBLIC_SITE_URL,
  };
}
