import type { Story } from "@/lib/types";

const base = new Date();
function hoursAgo(h: number, m = 0): string {
  const d = new Date(base);
  d.setHours(d.getHours() - h, m);
  return d.toISOString();
}

export const mockStories: Story[] = [
  {
    id: "1",
    source: { publisher: "Anthropic", kindCode: "scrape", localeCode: "en" },
    featured: true,
    title: "Reverse-engineering Claude's exploit for CVE-2026-2796",
    summary:
      "Deep-dive on how Claude Opus 4.6 produced a working exploit for a (now-patched) Firefox CVE in the JavaScript WebAssembly JIT. Given only a VM and a validator, the model succeeded within ~350 attempts.",
    tags: ["Agent", "Anthropic", "Safety/alignment"],
    importance: 85,
    tier: "featured",
    publishedAt: hoursAgo(2, 3),
    url: "https://www.anthropic.com/research/cve-2026-2796",
    locale: "en",
  },
  {
    id: "2",
    source: { publisher: "OpenAI", kindCode: "rss", localeCode: "en" },
    featured: true,
    title: "Product discovery lands inside ChatGPT",
    summary:
      "ChatGPT adds a richer shopping path backed by the Agentic Commerce protocol: discovery, parallel comparison across merchants, and in-chat checkout integration.",
    tags: ["Agent", "OpenAI", "Product update"],
    importance: 85,
    tier: "featured",
    publishedAt: hoursAgo(19, 44),
    url: "https://openai.com/blog/chatgpt-commerce",
    locale: "en",
  },
  {
    id: "3",
    source: { publisher: "Anthropic", kindCode: "scrape", localeCode: "en" },
    featured: true,
    title: "Let Claude use your computer",
    summary:
      "Computer-use research preview is now available to Pro/Max in Claude Cowork and Claude Code. Claude can drive the mouse, keyboard, and screen with per-action approval, live interrupt, and blocklists for sensitive apps.",
    tags: ["Agent", "Anthropic", "Product update"],
    importance: 88,
    tier: "featured",
    publishedAt: hoursAgo(30, 9),
    url: "https://www.anthropic.com/news/computer-use",
    crossSourceCount: 3,
    locale: "en",
  },
  {
    id: "4",
    source: { publisher: "Anthropic", kindCode: "scrape", localeCode: "en" },
    featured: true,
    title: "Claude Code ships auto-mode permissions",
    summary:
      "Claude Code 1.20 introduces auto-mode: declarative YAML rules that batch-approve tool calls by path+tool. Live interrupt and audit replay stay on.",
    tags: ["Agent", "Anthropic", "Product update"],
    importance: 82,
    tier: "featured",
    publishedAt: hoursAgo(32, 10),
    url: "https://www.anthropic.com/news/claude-code-auto",
    locale: "en",
  },
  {
    id: "5",
    source: { publisher: "Xiaomi", kindCode: "rsshub", localeCode: "zh" },
    featured: false,
    title: "Xiaomi releases multimodal model MIMO-V2-OMNI",
    summary:
      "Xiaomi open-sourced MIMO-V2-OMNI across text, image, audio at 78.4 / 85.2 on MMMU and MMBench-CN. At 72B params it runs on a single H100, ~1.6× throughput vs peers.",
    tags: ["Multimodal", "Xiaomi", "Open source"],
    importance: 76,
    tier: "all",
    publishedAt: hoursAgo(38, 22),
    url: "https://xiaomi.com/mimo-v2-omni",
    locale: "zh",
  },
  {
    id: "6",
    source: { publisher: "DeepMind", kindCode: "rss", localeCode: "en" },
    featured: false,
    title: "Gemini 3.1 Pro adds temporal-consistency video benchmark",
    summary:
      "DeepMind open-sources a 12-scenario video-generation evaluation. Gemini 3.1 Pro beats Sora 2.0 on physical consistency but still trails top models by ~6 points on character consistency.",
    tags: ["Multimodal", "Google", "Research release"],
    importance: 74,
    tier: "all",
    publishedAt: hoursAgo(45, 12),
    url: "https://deepmind.google/gemini-3-1-pro-video",
    locale: "en",
  },
  {
    id: "7",
    source: { publisher: "Dwarkesh Patel", kindCode: "rss", localeCode: "en" },
    featured: false,
    title: "Dario Amodei on the critical path to 2027",
    summary:
      "Dario predicts the first week-long autonomous coding agents arrive in H2 2026 and expects AI-assisted scientific discovery to cluster before end of 2027. Discusses interpretability and compliance investment.",
    tags: ["Agent", "Anthropic", "Commentary"],
    importance: 72,
    tier: "all",
    publishedAt: hoursAgo(52, 5),
    url: "https://www.dwarkeshpatel.com/p/dario-amodei-2027",
    locale: "en",
  },
  {
    id: "8",
    source: { publisher: "Synced (机器之心)", kindCode: "rsshub", localeCode: "zh" },
    featured: false,
    title: "ByteDance Doubao team publishes composable tool-agent framework",
    summary:
      "MosaicAgent (arXiv preprint): tool calls decomposed into atomic ops scheduled over a graph. Reports +11% average lift over ReAct on ToolBench.",
    tags: ["Agent", "ByteDance", "Research release"],
    importance: 70,
    tier: "all",
    publishedAt: hoursAgo(60, 30),
    url: "https://arxiv.org/abs/2604.00123",
    locale: "zh",
  },
];
