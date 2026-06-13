export const PUBLIC_SITE_URL = "https://news.ax0x.ai";
export const PUBLIC_SITE_HOST = "news.ax0x.ai";

export function publicUrl(path = ""): string {
  if (!path) return PUBLIC_SITE_URL;
  return `${PUBLIC_SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
