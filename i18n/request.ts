import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
    // Entity tags (OpenAI, Anthropic, etc.) aren't in tags.all.*; silently
    // fall back to the raw key instead of logging to Vercel console on every
    // SSR pass (was 100+ console.error calls per page render).
    onError: () => {},
    getMessageFallback: ({ key }) => key.split(".").pop() ?? key,
  };
});
