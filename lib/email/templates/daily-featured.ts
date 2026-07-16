import type { RenderedEmail } from "@/lib/email/contracts";
import {
  escapeEmailHtml,
  isSafeHref,
  subjectSafe,
} from "@/lib/email/escape";
import { renderEmailLayout } from "@/lib/email/templates/layout";
import {
  EMAIL_COLORS,
  EMAIL_FONT_BODY,
  EMAIL_FONT_MONO,
  EMAIL_STYLE,
} from "@/lib/email/templates/styles";

/** 每日精选 — the window's featured/p1 items with 锐评 (PLAN.md §5). */
export type FeaturedStory = {
  id: number;
  title: string;
  /** External original url — the only outbound link per story. */
  url: string;
  sourceName: string | null;
  tier: string | null;
  importance: number | null;
  summary: string | null;
  /** 锐评 (editor_analysis) — rendered as the styled blockquote. */
  analysis: string | null;
};

export type DailyFeaturedEmailInput = {
  dateKey: string;
  stories: FeaturedStory[];
  unsubscribeUrl: string;
};

function storyMeta(story: FeaturedStory): string {
  return [
    story.sourceName,
    story.tier,
    story.importance != null ? `imp ${story.importance}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function storyHtml(story: FeaturedStory, index: number): string {
  const meta = storyMeta(story);
  const title = escapeEmailHtml(story.title);
  const linkedTitle = isSafeHref(story.url)
    ? `<a href="${escapeEmailHtml(story.url)}" style="${EMAIL_STYLE.link}">${title}</a>`
    : title;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;">
<tr><td style="padding:0;background-color:${EMAIL_COLORS.card};color:${EMAIL_COLORS.text};" bgcolor="${EMAIL_COLORS.card}">
<div style="font-family:${EMAIL_FONT_MONO};font-size:12px;color:${EMAIL_COLORS.secondary};margin-bottom:4px;">${String(index + 1).padStart(2, "0")}</div>
<div style="font-family:${EMAIL_FONT_BODY};font-size:17px;font-weight:700;line-height:1.5;margin-bottom:4px;">${linkedTitle}</div>
${meta ? `<div style="font-family:${EMAIL_FONT_MONO};font-size:12px;color:${EMAIL_COLORS.secondary};margin-bottom:8px;">${escapeEmailHtml(meta)}</div>` : ""}
${story.summary ? `<p style="${EMAIL_STYLE.paragraph}">${escapeEmailHtml(story.summary)}</p>` : ""}
${story.analysis ? `<blockquote style="${EMAIL_STYLE.blockquote}"><span style="font-family:${EMAIL_FONT_MONO};font-size:11px;color:${EMAIL_COLORS.accent};">锐评</span><br />${escapeEmailHtml(story.analysis)}</blockquote>` : ""}
</td></tr>
</table>`;
}

function storyText(story: FeaturedStory, index: number): string {
  const meta = storyMeta(story);
  return [
    `${index + 1}. ${story.title}`,
    `   ${story.url}`,
    meta ? `   ${meta}` : "",
    story.summary ? `   ${story.summary}` : "",
    story.analysis ? `   锐评: ${story.analysis}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function renderDailyFeaturedEmail(
  input: DailyFeaturedEmailInput,
): RenderedEmail {
  const top = input.stories[0];
  const subject = subjectSafe(
    input.stories.length > 1
      ? `【AX 精选】${top?.title ?? ""} 等 ${input.stories.length} 条`
      : `【AX 精选】${top?.title ?? ""}`,
  );

  const bodyHtml = input.stories
    .map((story, index) => storyHtml(story, index))
    .join("\n");
  const bodyText = input.stories
    .map((story, index) => storyText(story, index))
    .join("\n\n");

  const { html, text } = renderEmailLayout({
    promptLine: `ax-radar --featured ${input.dateKey}`,
    preheader: top ? `${top.title}` : undefined,
    bodyHtml,
    bodyText,
    unsubscribeUrl: input.unsubscribeUrl,
  });

  return { subject, html, text };
}
