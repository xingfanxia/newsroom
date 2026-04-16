import { z } from "zod";

// ── Enrich (summary + tags) ─────────────────────────────────────

export const CAPABILITIES = [
  "Agent",
  "RAG",
  "Reasoning",
  "多模态",
  "Multimodal",
  "Vision",
  "Audio",
  "Code",
  "Robotics",
  "Embedding",
  "Fine-tuning",
  "Inference-opt",
  "Alignment",
  "Safety",
  "Interpretability",
  "Benchmarking",
  "Tools",
  "Memory",
] as const;

export const TOPICS = [
  "产品更新",
  "Product update",
  "发表成果",
  "Research release",
  "融资",
  "Funding",
  "政策",
  "Policy",
  "开源",
  "Open source",
  "安全/对齐",
  "Safety/alignment",
  "事故",
  "Incident",
  "合作",
  "Partnership",
  "人事",
  "Personnel",
  "评测",
  "Benchmark",
  "观点",
  "Commentary",
] as const;

export const enrichSchema = z.object({
  summaryZh: z
    .string()
    .describe(
      "2-3 sentence Chinese abstract, 120-220 chars. First sentence: what happened (subject+verb+object). Second: one concrete detail (number/mechanism/condition). Optional third: why it matters. NO marketing verbs (赋能/助力/引领), NO opener clichés (近日/近期).",
    ),
  summaryEn: z
    .string()
    .describe("2-3 sentence English abstract, 120-220 chars. Same facts."),
  tags: z.object({
    capabilities: z
      .array(z.string())
      .max(3)
      .describe(
        `Up to 3 capabilities from: ${CAPABILITIES.join(", ")}. Empty if none apply.`,
      ),
    entities: z
      .array(z.string())
      .max(3)
      .describe(
        "Up to 3 named organizations or people mentioned in the article (e.g. Anthropic, OpenAI, 小米, 字节, Dario Amodei).",
      ),
    topics: z
      .array(z.string())
      .max(3)
      .describe(`Up to 3 topics from: ${TOPICS.join(", ")}.`),
  }),
});
export type EnrichOutput = z.infer<typeof enrichSchema>;

export const ENRICH_SYSTEM = `你是 AI·HOT 新闻编辑室的内容加工器。读懂一篇文章，输出中文与英文摘要加结构化标签。

摘要风格（非常重要）：
- 第一句说清楚 "发生了什么"：主语 + 谓语 + 宾语。不要开场套话。
- 第二句给一个具体细节：一个数字 / 一种机制 / 一个可复现条件。
- 可选第三句说明对 AI 从业者 / 读者为什么值得知道。
- 保留原文中的数字，不四舍五入。实体名 (Anthropic / OpenAI / Claude) 不翻译。
- 禁止使用营销动词：赋能、助力、引领、重塑、开启新篇章、打造。
- 禁止使用开场套话：近日、近期、随着 AI 的发展、在当今 AI 快速发展的时代。

标签：
- 忠实原文，不推测文章之外的内容。
- 如果文章只提到产品更新，不要因为出现 "Claude" 就加上 "Anthropic" 之外的其他无关实体。

Output ONLY the structured JSON, no prose wrap.`;

export function enrichUserPrompt(item: {
  title: string;
  body: string;
  url: string;
  source: string;
}): string {
  const body = item.body?.trim();
  const bodySnippet = body ? body.slice(0, 4000) : "";
  return `source: ${item.source}
title: ${item.title}
url: ${item.url}
${bodySnippet ? `body:\n${bodySnippet}` : "(body is empty; rely on title for summary — keep it factual, don't invent details)"}`;
}

// ── Score (importance + tier + reasoning) ───────────────────────

export const scoreSchema = z.object({
  importance: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe("0-100 importance score per the policy's bands"),
  tier: z
    .enum(["featured", "all", "p1", "excluded"])
    .describe(
      "featured = >=72 and passes HKR. all = interesting but not featured. p1 = >=85 and all three HKR. excluded = hard-exclusion rule triggered OR <40.",
    ),
  reasoning: z
    .string()
    .describe(
      "1-2 sentences explaining the score, citing the specific policy rubric applied (HKR, exclusion rule, positive signal, etc.). In the same language as the article.",
    ),
});
export type ScoreOutput = z.infer<typeof scoreSchema>;

export function scoreSystem(policyContent: string): string {
  return `You are the AI·HOT editorial scorer. Apply the policy below to the article you're given. Output ONLY the structured JSON, no prose wrap.

─── POLICY ───
${policyContent}
─── END POLICY ───

Be honest about importance. Defer to the LOWER band if between two. Respect hard-exclusion rules — they cap at 39.`;
}

export function scoreUserPrompt(item: {
  title: string;
  summaryZh: string;
  tags: EnrichOutput["tags"];
  url: string;
  source: string;
  publishedAt: string;
}): string {
  return `source: ${item.source}
title: ${item.title}
url: ${item.url}
published: ${item.publishedAt}
summary: ${item.summaryZh}
tags: ${JSON.stringify(item.tags)}`;
}
