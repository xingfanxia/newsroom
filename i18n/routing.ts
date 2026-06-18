import { defineRouting } from "next-intl/routing";
import { APP_LOCALES } from "@/lib/types";

export const routing = defineRouting({
  locales: APP_LOCALES,
  defaultLocale: "zh",
  localeDetection: true,
  localePrefix: "always",
});

export type Locale = (typeof routing.locales)[number];
