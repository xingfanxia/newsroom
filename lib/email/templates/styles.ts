/**
 * Email design tokens — mirrors the RUNTIME palette in app/globals.css
 * (authoritative; DESIGN.md's cyan is aspirational drift — PLAN.md §0).
 * Everything inline-styled: email clients strip <style> blocks.
 */
export const EMAIL_COLORS = {
  bg: "#0a0a0a",
  card: "#0d1117",
  border: "rgba(255,255,255,0.08)",
  text: "#f0f6fc",
  secondary: "#8b949e",
  link: "#58a6ff",
  accent: "#3fb950",
} as const;

export const EMAIL_FONT_BODY =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif";

export const EMAIL_FONT_MONO =
  "ui-monospace, 'JetBrains Mono', Menlo, Consolas, monospace";

/** Shared inline-style fragments for rendered markdown + templates. */
export const EMAIL_STYLE = {
  paragraph: `margin:0 0 16px;color:${EMAIL_COLORS.text};font-size:15px;line-height:1.8;`,
  h2: `margin:32px 0 12px;color:${EMAIL_COLORS.text};font-size:18px;line-height:1.5;font-weight:700;`,
  h3: `margin:24px 0 10px;color:${EMAIL_COLORS.text};font-size:16px;line-height:1.5;font-weight:700;`,
  em: `font-style:italic;color:${EMAIL_COLORS.text};`,
  blockquote: `margin:0 0 16px;padding:2px 0 2px 14px;border-left:3px solid ${EMAIL_COLORS.accent};color:${EMAIL_COLORS.secondary};font-size:14px;line-height:1.8;`,
  list: `margin:0 0 16px;padding-left:22px;color:${EMAIL_COLORS.text};font-size:15px;line-height:1.8;`,
  listItem: `margin:0 0 6px;`,
  link: `color:${EMAIL_COLORS.link};text-decoration:underline;`,
  strong: `font-weight:700;color:${EMAIL_COLORS.text};`,
} as const;
