import { defineRouting } from "next-intl/routing";
import { APP_LOCALES, DEFAULT_APP_LOCALE } from "@/lib/types";

export const routing = defineRouting({
  locales: APP_LOCALES,
  defaultLocale: DEFAULT_APP_LOCALE,
  localeDetection: true,
  localePrefix: "always",
});

export type Locale = (typeof routing.locales)[number];
