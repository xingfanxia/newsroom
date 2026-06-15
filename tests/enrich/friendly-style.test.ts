import { describe, expect, it } from "bun:test";
import { readSource } from "@/tests/helpers/source";

const promptSrc = readSource("workers/enrich/prompt.ts");
const chineseSrc = readSource("workers/enrich/chinese.ts");
const dailyColumnPrompt = readSource("lib/llm/prompts/daily-column.md");

describe("friend-readable editorial style", () => {
  it("tells both English and Chinese generators to sound like a friend sharing a link", () => {
    expect(promptSrc).toContain("friend sharing a link");
    expect(promptSrc).toContain("像发给朋友");
    expect(chineseSrc).toContain("像发给朋友");
  });

  it("prioritizes plain language over sharp-sounding jargon", () => {
    expect(promptSrc).toContain("先让人读懂");
    expect(chineseSrc).toContain("先让人读懂");
    expect(promptSrc).toContain("术语要翻译成人话");
    expect(chineseSrc).toContain("术语要翻译成人话");
  });

  it("does not frame commentary as forced sharp takes", () => {
    expect(promptSrc).not.toContain("一个尖锐论断");
    expect(promptSrc).not.toContain("最锋利的视角");
    expect(promptSrc).not.toContain("必须有一处具体钩子");
  });

  it("sets daily columns to the same friend-readable style", () => {
    expect(dailyColumnPrompt).toContain("像发给朋友");
    expect(dailyColumnPrompt).toContain("先让人读懂");
    expect(dailyColumnPrompt).toContain("术语要翻译成人话");
    expect(dailyColumnPrompt).not.toContain("黑色幽默");
    expect(dailyColumnPrompt).not.toContain("文化升维");
  });
});
