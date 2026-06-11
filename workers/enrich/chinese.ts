import { z } from "zod";
import { generateStructured, profiles } from "@/lib/llm";
import type { EnrichOutput, ScoreOutput } from "./prompt";
import type { EnrichTreatment } from "./treatment";

const ZH_PROSE_SYSTEM = `你是 AX AI 雷达的中文编辑。只写中文字段，英文和结构化评分由另一个模型负责。

硬规则：
- 只输出 schema 要求的 JSON key，不能改名，不能新增 key。
- 最高目标：先让人读懂，像发给朋友解释一条链接。
- 第一句直接给事实或判断，不用"近日/值得注意/这意味着/本质上/随着 AI"。
- 术语要翻译成人话。比如 DV-DPO 后面补一句"用偏好样本教小模型学回答风格"；RAG 写成"外挂资料库"；agent workflow 写成"让模型进业务流程干活"。
- 数字要留，但要解释数字说明什么：成本低、样本少、延迟高、验证弱。
- 不写公关稿，不写"赋能/助力/引领/重塑/开启新篇章/打造"。
- 信息不够就直说"正文没披露 X"，不要补设定。
- 给 AI 从业者看，但不要写成论文摘要、咨询报告或翻译腔。
- 可以自然一点："我会先打个折"、"这点先别太激动"、"如果是真的挺省钱"。判断必须挂在事实或信息缺口上。`;

const ZH_COMMENTARY_SYSTEM = `${ZH_PROSE_SYSTEM}

短评不是摘要。它应该像你看完这条新闻后发给朋友的一句话：这条哪里值得点，哪里要打折。短评最多 90 个中文字符。

点评目标 180-320 字，1-3 段。结构：先说人话判断 + 关键数字/来源限制 + 还缺什么。不要堆术语链，不要为了显得高级把句子写绕。`;

function profileForTreatment(treatment?: EnrichTreatment) {
  return treatment === "fast" ? profiles.fastText : profiles.zhText;
}

function neutralizeInjection(text: string): string {
  if (!text) return "";
  return text
    .replace(/<\/?article[^>]*>/gi, "")
    .replace(/<\|im_(start|end)\|>/gi, "")
    .replace(/\[INST\]|\[\/INST\]/gi, "")
    .replace(/^[\s>]*SYSTEM\s*[:：]/gim, "")
    .replace(/^[\s>]*ASSISTANT\s*[:：]/gim, "")
    .replace(/```(?:system|assistant)/gi, "```");
}

function pickBody(opts: { body?: string; bodyMd?: string | null }, limit: number): string {
  const md = (opts.bodyMd ?? "").trim();
  if (md.length >= 400) return neutralizeInjection(md).slice(0, limit);
  return neutralizeInjection((opts.body ?? "").trim()).slice(0, limit);
}

function boundedText(max: number, min = 1) {
  return z.string().min(min).transform((s) =>
    s.length > max ? `${s.slice(0, Math.max(0, max - 3))}...` : s,
  );
}

export const zhEnrichSchema = z.object({
  titleZh: boundedText(80),
  summaryZh: boundedText(180, 20),
});

export type ZhEnrichOutput = z.infer<typeof zhEnrichSchema>;

export function zhEnrichUserPrompt(item: {
  title: string;
  body: string;
  bodyMd?: string | null;
  url: string;
  source: string;
  titleEn?: string | null;
  summaryEn?: string | null;
}): string {
  const body = pickBody({ body: item.body, bodyMd: item.bodyMd }, 8000);
  return `<article source="untrusted">
source_id: ${item.source}
url: ${item.url}
raw_title: ${neutralizeInjection(item.title)}
existing_title_en: ${neutralizeInjection(item.titleEn ?? "")}
existing_summary_en: ${neutralizeInjection(item.summaryEn ?? "")}
${body ? `body:\n${body}` : "(body is empty; rely on title only and state the missing detail)"}
</article>

Output JSON must use exactly these keys: titleZh, summaryZh.`;
}

export async function generateChineseEnrichment(input: Parameters<typeof zhEnrichUserPrompt>[0] & {
  itemId?: number;
  treatment?: EnrichTreatment;
}): Promise<ZhEnrichOutput> {
  const result = await generateStructured({
    ...profileForTreatment(input.treatment),
    task: "enrich",
    itemId: input.itemId,
    system: ZH_PROSE_SYSTEM,
    messages: [{ role: "user", content: zhEnrichUserPrompt(input) }],
    schema: zhEnrichSchema,
    schemaName: "ChineseEnrichment",
    schemaDescription: "Chinese-only title and summary fields.",
    maxTokens: 768,
  });
  return result.data;
}

export const zhScoreRationaleSchema = z.object({
  hkrReasonsZh: z.object({
    h: boundedText(80),
    k: boundedText(80),
    r: boundedText(80),
  }),
  reasoningZh: boundedText(280),
});

export type ZhScoreRationaleOutput = z.infer<typeof zhScoreRationaleSchema>;

export function zhScoreRationalePrompt(input: {
  title: string;
  summaryZh: string;
  tags: EnrichOutput["tags"];
  score: ScoreOutput;
}): string {
  return `Article:
title: ${neutralizeInjection(input.title)}
summary_zh: ${neutralizeInjection(input.summaryZh)}
tags: ${JSON.stringify(input.tags)}

Existing scoring decision to preserve:
importance: ${input.score.importance}
tier: ${input.score.tier}
hkr: ${JSON.stringify({
  h: input.score.hkr.h,
  k: input.score.hkr.k,
  r: input.score.hkr.r,
  reasonsEn: input.score.hkr.reasonsEn,
  reasoningEn: input.score.reasoningEn,
})}

Write the Chinese recommendation/rationale only. Do not change the score, tier, or booleans.
Output JSON must use exactly these keys: hkrReasonsZh, reasoningZh.`;
}

export async function generateChineseScoreRationale(input: Parameters<typeof zhScoreRationalePrompt>[0] & {
  itemId?: number;
  treatment?: EnrichTreatment;
}): Promise<ZhScoreRationaleOutput> {
  const result = await generateStructured({
    ...profileForTreatment(input.treatment),
    task: "score",
    itemId: input.itemId,
    system: ZH_PROSE_SYSTEM,
    messages: [{ role: "user", content: zhScoreRationalePrompt(input) }],
    schema: zhScoreRationaleSchema,
    schemaName: "ChineseScoreRationale",
    schemaDescription: "Chinese-only HKR reasons and score rationale.",
    maxTokens: 768,
  });
  return result.data;
}

export const zhCommentarySchema = z.object({
  editorNoteZh: boundedText(200),
  editorAnalysisZh: z.string().min(20),
});

export const zhCommentaryNoteSchema = z.object({
  editorNoteZh: boundedText(200),
});

export type ZhCommentaryOutput = z.infer<typeof zhCommentarySchema>;
export type ZhCommentaryNoteOutput = z.infer<typeof zhCommentaryNoteSchema>;

export async function generateChineseCommentary(input: {
  task: "commentary" | "event-commentary";
  itemId?: number;
  userContent: string;
  full: boolean;
  treatment?: EnrichTreatment;
}): Promise<ZhCommentaryOutput | ZhCommentaryNoteOutput> {
  const schema = input.full ? zhCommentarySchema : zhCommentaryNoteSchema;
  const result = await generateStructured({
    ...profileForTreatment(input.treatment),
    task: input.task,
    itemId: input.itemId,
    system: ZH_COMMENTARY_SYSTEM,
    messages: [
      {
        role: "user",
        content: `${input.userContent}

Only write Chinese fields. Output JSON must use exactly these keys: ${
          input.full ? "editorNoteZh, editorAnalysisZh" : "editorNoteZh"
        }.`,
      },
    ],
    schema,
    schemaName: input.full ? "ChineseCommentary" : "ChineseCommentaryNote",
    schemaDescription: "Chinese-only editorial commentary fields.",
    maxTokens: input.full ? 1024 : 384,
  });
  return result.data;
}
