import { describe, expect, it } from "bun:test";
import { enrichSchema, scoreSchema } from "@/workers/enrich/prompt";

describe("enrichSchema", () => {
  it("normalizes natural-language DeepSeek tag labels into canonical enums", () => {
    const parsed = enrichSchema.parse({
      titleZh: "Midjourney V8.1 成为默认模型，生成速度最快 4 秒",
      titleEn:
        "Midjourney V8.1 is now the default model, renders in as fast as 4 seconds",
      summaryZh:
        "Midjourney 把 V8.1 设为默认模型，取代了 V7。新模型更听话，标准模式 4 秒出图。",
      summaryEn:
        "Midjourney has made V8.1 the default model, replacing V7. It follows detailed prompts better and renders quickly.",
      tags: {
        capabilities: [
          "image generation",
          "text rendering",
          "high resolution",
          "speed improvement",
        ],
        entities: ["Midjourney"],
        topics: [
          "model update",
          "default model change",
          "product announcement",
        ],
      },
    });

    expect(parsed.tags.capabilities).toEqual(["Vision", "Inference-opt"]);
    expect(parsed.tags.topics).toEqual(["Product update"]);
  });

  it("drops unknown tag labels instead of rejecting the whole enrichment", () => {
    const parsed = enrichSchema.parse({
      titleZh: "测试标题",
      titleEn: "Test title",
      summaryZh: "这是一条测试摘要，正文没披露更多细节。",
      summaryEn: "This is a test summary; the post does not disclose more detail.",
      tags: {
        capabilities: ["totally custom label"],
        entities: [],
        topics: ["another custom label"],
      },
    });

    expect(parsed.tags.capabilities).toEqual([]);
    expect(parsed.tags.topics).toEqual([]);
  });

  it("caps overlong tag arrays instead of rejecting the whole enrichment", () => {
    const parsed = enrichSchema.parse({
      titleZh: "测试标题",
      titleEn: "Test title",
      summaryZh: "这是一条测试摘要，正文没披露更多细节。",
      summaryEn: "This is a test summary; the post does not disclose more detail.",
      tags: {
        capabilities: ["Agent", "RAG", "Code", "Vision"],
        entities: ["OpenAI", "Anthropic", "Google", "Microsoft"],
        topics: ["Product update", "Research release", "Funding", "Policy"],
      },
    });

    expect(parsed.tags.capabilities).toEqual(["Agent", "RAG", "Code"]);
    expect(parsed.tags.entities).toEqual(["OpenAI", "Anthropic", "Google"]);
    expect(parsed.tags.topics).toEqual([
      "Product update",
      "Research release",
      "Funding",
    ]);
  });
});

describe("scoreSchema", () => {
  it("truncates overlong score rationale strings instead of rejecting the item", () => {
    const parsed = scoreSchema.parse({
      importance: 72,
      tier: "featured",
      hkr: {
        h: true,
        k: true,
        r: false,
        reasonsZh: {
          h: "这条标题有明确反差和点击理由。".repeat(8),
          k: "正文给了可验证的信息和具体对象。".repeat(8),
          r: "讨论点偏工程实践，但情绪钩子一般。".repeat(8),
        },
        reasonsEn: {
          h: "The hook is concrete and has a clear reason to click. ".repeat(5),
          k: "The post gives a named project and a testable claim. ".repeat(5),
          r: "It is relevant to AI builders but not especially emotional. ".repeat(5),
        },
      },
      reasoningZh: "这条值得进精选，因为它给了明确对象和工程钩子，但判断仍要看正文是否披露了实际效果。".repeat(8),
      reasoningEn:
        "This is worth featuring because it gives a concrete AI engineering hook, but the judgment still depends on whether the article discloses real results. ".repeat(
          5,
        ),
    });

    expect(parsed.hkr.reasonsZh.h.length).toBeLessThanOrEqual(80);
    expect(parsed.hkr.reasonsEn.h.length).toBeLessThanOrEqual(100);
    expect(parsed.reasoningZh.length).toBeLessThanOrEqual(280);
    expect(parsed.reasoningEn.length).toBeLessThanOrEqual(280);
  });
});
