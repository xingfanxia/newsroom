import type { RenderedEmail } from "@/lib/email/contracts";
import { SITE_ORIGIN } from "@/lib/email/contracts";
import {
  escapeEmailHtml,
  isSafeHref,
  subjectSafe,
} from "@/lib/email/escape";
import { renderEmailMarkdown, renderEmailText } from "@/lib/email/markdown";
import { renderEmailLayout } from "@/lib/email/templates/layout";
import {
  EMAIL_COLORS,
  EMAIL_FONT_BODY,
  EMAIL_FONT_MONO,
  EMAIL_STYLE,
} from "@/lib/email/templates/styles";

/** 每日日报 — the daily column as email (PLAN.md §5). */
export type DailyDigestEmailInput = {
  title: string;
  themeTag: string | null;
  /** YYYY-MM-DD of the column window end — also the web permalink key. */
  dateKey: string;
  summaryMd: string;
  narrativeMd: string;
  /** The 1-3 featured items the narrative gives deep treatment. */
  featured: Array<{ id: number; title: string; url: string }>;
  /** [#NNNN] refs resolve to EXTERNAL item urls (never /zh/items/). */
  itemUrlById: Map<number, string>;
  unsubscribeUrl: string;
};

export function renderDailyDigestEmail(
  input: DailyDigestEmailInput,
): RenderedEmail {
  const webVersionUrl = `${SITE_ORIGIN}/zh/daily/${input.dateKey}`;
  const markdownOpts = { itemUrlById: input.itemUrlById };

  const featuredHtml =
    input.featured.length > 0
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 16px;">
<tr><td style="padding:14px 16px;background-color:${EMAIL_COLORS.bg};border:1px solid ${EMAIL_COLORS.border};border-left:3px solid ${EMAIL_COLORS.accent};border-radius:6px;" bgcolor="${EMAIL_COLORS.bg}">
<div style="font-family:${EMAIL_FONT_MONO};font-size:12px;color:${EMAIL_COLORS.accent};margin-bottom:8px;">★ 今日精选</div>
${input.featured
  .map((item) => {
    const title = escapeEmailHtml(item.title);
    const linked = isSafeHref(item.url)
      ? `<a href="${escapeEmailHtml(item.url)}" style="${EMAIL_STYLE.link}">${title}</a>`
      : title;
    return `<div style="font-family:${EMAIL_FONT_BODY};font-size:14px;line-height:1.9;">${linked}</div>`;
  })
  .join("")}
</td></tr>
</table>`
      : "";

  const bodyHtml = `<h1 style="margin:0 0 6px;font-family:${EMAIL_FONT_BODY};font-size:22px;line-height:1.5;font-weight:700;color:${EMAIL_COLORS.text};">${escapeEmailHtml(input.title)}</h1>
<div style="margin:0 0 18px;font-family:${EMAIL_FONT_MONO};font-size:12px;color:${EMAIL_COLORS.secondary};">${escapeEmailHtml(input.dateKey)}</div>
${renderEmailMarkdown(input.summaryMd, markdownOpts)}
${featuredHtml}
${renderEmailMarkdown(input.narrativeMd, markdownOpts)}`;

  const bodyText = [
    input.title,
    input.dateKey,
    "",
    renderEmailText(input.summaryMd),
    input.featured.length > 0
      ? `\n★ 今日精选\n${input.featured
          .map((item) => `- ${item.title} (${item.url})`)
          .join("\n")}`
      : "",
    "",
    renderEmailText(input.narrativeMd),
  ]
    .filter((part) => part !== "")
    .join("\n");

  const { html, text } = renderEmailLayout({
    promptLine: `ax-radar --daily ${input.dateKey}`,
    themeTag: input.themeTag,
    preheader: renderEmailText(input.summaryMd).slice(0, 90),
    bodyHtml,
    bodyText,
    webVersionUrl,
    unsubscribeUrl: input.unsubscribeUrl,
  });

  return { subject: subjectSafe(`【AX 日报】${input.title}`), html, text };
}
