import type { RenderedEmail } from "@/lib/email/contracts";
import {
  escapeEmailHtml,
  renderEmailLayout,
} from "@/lib/email/templates/layout";
import {
  EMAIL_COLORS,
  EMAIL_FONT_BODY,
  EMAIL_FONT_MONO,
  EMAIL_STYLE,
} from "@/lib/email/templates/styles";

/** Double-opt-in confirmation email (PLAN.md §1.3). */
export type ConfirmEmailInput = {
  confirmUrl: string;
};

export function renderConfirmEmail(input: ConfirmEmailInput): RenderedEmail {
  const url = escapeEmailHtml(input.confirmUrl);
  const bodyHtml = `<p style="${EMAIL_STYLE.paragraph}">点一下下面的按钮，确认订阅 <strong style="${EMAIL_STYLE.strong}">AX 的 AI 雷达</strong>。确认后每天 13:40（北京时间）收到当天的日报和精选。</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0;">
<tr><td style="background-color:${EMAIL_COLORS.accent};border-radius:6px;" bgcolor="${EMAIL_COLORS.accent}">
<a href="${url}" style="display:inline-block;padding:12px 28px;font-family:${EMAIL_FONT_BODY};font-size:15px;font-weight:700;color:#0a0a0a;text-decoration:none;">确认订阅</a>
</td></tr>
</table>
<p style="margin:0 0 8px;color:${EMAIL_COLORS.secondary};font-family:${EMAIL_FONT_BODY};font-size:13px;line-height:1.8;">按钮点不了？复制这个链接到浏览器：</p>
<p style="margin:0 0 16px;font-family:${EMAIL_FONT_MONO};font-size:12px;line-height:1.6;word-break:break-all;"><a href="${url}" style="${EMAIL_STYLE.link}">${url}</a></p>
<p style="margin:0;color:${EMAIL_COLORS.secondary};font-family:${EMAIL_FONT_BODY};font-size:13px;line-height:1.8;">不是你操作的？忽略这封邮件即可，不会有任何订阅生效。</p>`;

  const bodyText = `点开下面的链接，确认订阅 AX 的 AI 雷达。确认后每天 13:40（北京时间）收到当天的日报和精选。

确认订阅: ${input.confirmUrl}

不是你操作的？忽略这封邮件即可，不会有任何订阅生效。`;

  const { html, text } = renderEmailLayout({
    promptLine: "ax-radar --subscribe --confirm",
    preheader: "确认订阅 AX 的 AI 雷达 — 点一下就生效",
    bodyHtml,
    bodyText,
  });

  return { subject: "【AX】确认订阅 AX 的 AI 雷达", html, text };
}
