import {
  EMAIL_COLORS,
  EMAIL_FONT_BODY,
  EMAIL_FONT_MONO,
} from "@/lib/email/templates/styles";
import { SITE_ORIGIN } from "@/lib/email/contracts";
import { escapeEmailHtml } from "@/lib/email/escape";

export { escapeEmailHtml } from "@/lib/email/escape";

/**
 * Shared table-layout shell — dark-native 600px card on the runtime
 * terminal palette. The signature element is the shell-prompt header
 * line (echoes the site's `cat newsletter/daily/*.md` crumb): every
 * kind announces itself as a command. All styles inline; explicit
 * color + bgcolor on every painted cell (Gmail dark-mode repaints).
 */
export type EmailLayoutInput = {
  /** Rendered after the `$ ` prompt, e.g. `ax-radar --daily 2026-07-16`. */
  promptLine: string;
  /** Theme chip text (日报 theme_tag). Escaped by caller? NO — escaped here. */
  themeTag?: string | null;
  /** Hidden preview line shown by inbox list views. Escaped here. */
  preheader?: string;
  bodyHtml: string;
  bodyText: string;
  webVersionUrl?: string;
  unsubscribeUrl?: string;
};

const FOOTER_LINK_STYLE = `color:${EMAIL_COLORS.secondary};text-decoration:underline;`;

export function renderEmailLayout(input: EmailLayoutInput): {
  html: string;
  text: string;
} {
  const themeChip = input.themeTag
    ? `<span style="display:inline-block;margin-left:10px;padding:1px 8px;border:1px solid ${EMAIL_COLORS.accent};border-radius:999px;color:${EMAIL_COLORS.accent};font-family:${EMAIL_FONT_MONO};font-size:12px;">${escapeEmailHtml(input.themeTag)}</span>`
    : "";

  const footerLinks = [
    input.webVersionUrl
      ? `<a href="${escapeEmailHtml(input.webVersionUrl)}" style="${FOOTER_LINK_STYLE}">在网页上看这期</a>`
      : "",
    `<a href="${SITE_ORIGIN}" style="${FOOTER_LINK_STYLE}">news.ax0x.ai</a>`,
    input.unsubscribeUrl
      ? `<a href="${escapeEmailHtml(input.unsubscribeUrl)}" style="${FOOTER_LINK_STYLE}">退订</a>`
      : "",
  ]
    .filter(Boolean)
    .join(`<span style="color:${EMAIL_COLORS.secondary};">&nbsp;&nbsp;·&nbsp;&nbsp;</span>`);

  const html = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="dark" />
<meta name="supported-color-schemes" content="dark" />
</head>
<body style="margin:0;padding:0;background-color:${EMAIL_COLORS.bg};" bgcolor="${EMAIL_COLORS.bg}">
${
  input.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeEmailHtml(input.preheader)}</div>`
    : ""
}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${EMAIL_COLORS.bg};" bgcolor="${EMAIL_COLORS.bg}">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:${EMAIL_COLORS.card};border:1px solid ${EMAIL_COLORS.border};border-radius:8px;" bgcolor="${EMAIL_COLORS.card}">
<tr><td style="padding:26px 28px 0;background-color:${EMAIL_COLORS.card};" bgcolor="${EMAIL_COLORS.card}">
<div style="font-family:${EMAIL_FONT_MONO};font-size:13px;line-height:1.6;color:${EMAIL_COLORS.accent};">$ ${escapeEmailHtml(input.promptLine)}</div>
<div style="margin-top:10px;font-family:${EMAIL_FONT_BODY};font-size:16px;font-weight:700;color:${EMAIL_COLORS.text};">AX 的 AI 雷达 <span style="font-family:${EMAIL_FONT_MONO};font-size:11px;font-weight:400;letter-spacing:2px;color:${EMAIL_COLORS.secondary};">AI&nbsp;RADAR</span>${themeChip}</div>
<div style="margin-top:14px;border-bottom:1px solid ${EMAIL_COLORS.border};font-size:0;line-height:0;">&nbsp;</div>
</td></tr>
<tr><td style="padding:20px 28px 8px;background-color:${EMAIL_COLORS.card};font-family:${EMAIL_FONT_BODY};color:${EMAIL_COLORS.text};" bgcolor="${EMAIL_COLORS.card}">
${input.bodyHtml}
</td></tr>
<tr><td style="padding:8px 28px 26px;background-color:${EMAIL_COLORS.card};" bgcolor="${EMAIL_COLORS.card}">
<div style="border-top:1px solid ${EMAIL_COLORS.border};padding-top:16px;font-family:${EMAIL_FONT_MONO};font-size:12px;line-height:2;color:${EMAIL_COLORS.secondary};">
${footerLinks}
<br /><span style="color:${EMAIL_COLORS.secondary};">由 news.ax0x.ai 发出 · 此地址不收件</span>
</div>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const textFooter = [
    input.webVersionUrl ? `网页版: ${input.webVersionUrl}` : "",
    input.unsubscribeUrl ? `退订: ${input.unsubscribeUrl}` : "",
    SITE_ORIGIN,
  ]
    .filter(Boolean)
    .join("\n");

  const text = `AX 的 AI 雷达 · AI RADAR
$ ${input.promptLine}${input.themeTag ? `\n[${input.themeTag}]` : ""}

${input.bodyText}

——
${textFooter}`;

  return { html, text };
}
