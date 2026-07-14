import { NEWSLETTER_LOCALES, type NewsletterLocale } from "@/lib/types";

const NEWSLETTER_RSS_LOCALE_SET = new Set<string>(NEWSLETTER_LOCALES);

export function parseNewsletterRssLocale(raw: string): NewsletterLocale {
  return NEWSLETTER_RSS_LOCALE_SET.has(raw) ? (raw as NewsletterLocale) : "zh";
}
