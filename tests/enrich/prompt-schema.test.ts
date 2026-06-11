import { describe, expect, it } from "bun:test";
import { enrichSchema } from "@/workers/enrich/prompt";

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
});
