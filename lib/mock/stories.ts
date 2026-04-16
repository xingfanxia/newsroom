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
    source: {
      publisher: "Anthropic",
      kindLabel: "Research（发表成果·网页）",
    },
    featured: true,
    title: "逆向分析 Claude 对 CVE-2026-2796 漏洞的利用程序",
    summary:
      "本文深入探讨了 Claude Opus 4.6 如何成功编写针对 Firefox 中 CVE-2026-2796 漏洞（现已修复）的利用程序。该漏洞源于 JavaScript WebAssembly 组件中，当通过特定包装器传递函数时，JIT 编译器存在错误编译问题。研究团队在仅提供虚拟机和验证器的条件下，给予模型约 350 次尝试机会后，其成功生成了概念验证利用程序。",
    tags: ["Agent", "Anthropic", "安全/对齐"],
    importance: 85,
    tier: "featured",
    publishedAt: hoursAgo(2, 3),
    url: "https://www.anthropic.com/research/cve-2026-2796",
    crossSourceCount: 0,
    locale: "zh",
  },
  {
    id: "2",
    source: {
      publisher: "OpenAI",
      kindLabel: "官网动态（RSS·排除企业/客户案例）",
    },
    featured: true,
    title: "在 ChatGPT 中赋能产品发现",
    summary:
      "ChatGPT 通过引入基于 Agentic Commerce 协议的增强功能，实现了更丰富、更具视觉沉浸感的购物体验。该系统支持商品发现、多产品并行比较以及商家服务集成，将对话式人工智能与电子商务场景深度融合，为用户提供直观的交互式购物决策支持。",
    tags: ["Agent", "OpenAI", "产品更新"],
    importance: 85,
    tier: "featured",
    publishedAt: hoursAgo(19, 44),
    url: "https://openai.com/blog/chatgpt-commerce",
    locale: "en",
  },
  {
    id: "3",
    source: {
      publisher: "Claude",
      kindLabel: "Blog（网页）",
    },
    featured: true,
    title: "让 Claude 在您的电脑上工作",
    summary:
      "Anthropic 公司于 2026 年 3 月 23 日宣布，为 Claude Cowork 和 Claude Code 应用推出电脑控制研究预览功能。该功能允许 Claude Pro 和 Max 订阅用户授权 Claude 直接操作其电脑的鼠标、键盘和屏幕，以完成打开文件、使用浏览器等任务。系统设有严格安全措施：执行前需用户明确许可、自动扫描模型活动、支持随时中断，并默认禁止访问敏感应用。",
    tags: ["Agent", "Anthropic", "产品更新"],
    importance: 88,
    tier: "featured",
    publishedAt: hoursAgo(30, 9),
    url: "https://www.anthropic.com/news/computer-use",
    crossSourceCount: 3,
    locale: "zh",
  },
  {
    id: "4",
    source: {
      publisher: "Anthropic",
      kindLabel: "Research（发表成果·网页）",
    },
    featured: true,
    title: "Claude Code 推出「自动模式」权限管理",
    summary:
      "Claude Code 1.20 版本引入自动模式（auto mode），允许用户将 Claude 的工具调用从一次一问切换为按规则批量放行。该功能通过 YAML 形式的权限规则指定哪些工具、哪些路径可以无人值守运行，同时保留了实时中断和审计回放能力。",
    tags: ["Agent", "Anthropic", "产品更新"],
    importance: 82,
    tier: "featured",
    publishedAt: hoursAgo(32, 10),
    url: "https://www.anthropic.com/news/claude-code-auto",
    locale: "zh",
  },
  {
    id: "5",
    source: {
      publisher: "小米",
      kindLabel: "官网动态（RSS·大模型）",
    },
    featured: false,
    title: "小米发布多模态大模型 MIMO-V2-OMNI",
    summary:
      "小米今日发布开源多模态大模型 MIMO-V2-OMNI，覆盖文字、图像、音频三种模态，在 MMMU 与 MMBench-CN 上分别达到 78.4 与 85.2 的成绩。模型在 72B 参数规模下即可运行于单张 H100，推理吞吐约为同规模开源模型的 1.6 倍。",
    tags: ["多模态", "小米", "开源"],
    importance: 76,
    tier: "all",
    publishedAt: hoursAgo(38, 22),
    url: "https://xiaomi.com/mimo-v2-omni",
    locale: "zh",
  },
  {
    id: "6",
    source: {
      publisher: "DeepMind",
      kindLabel: "Research（发表成果·网页）",
    },
    featured: false,
    title: "Gemini 3.1 Pro 引入时间一致性视频生成评测集",
    summary:
      "Google DeepMind 发布 Gemini 3.1 Pro 的视频生成扩展评测，并开源一个涵盖 12 类动态场景的基准测试集。团队报告模型在物理一致性得分上超过了 Sora 2.0，但在角色一致性上仍与顶尖模型存在约 6 分差距。",
    tags: ["多模态", "Google", "发表成果"],
    importance: 74,
    tier: "all",
    publishedAt: hoursAgo(45, 12),
    url: "https://deepmind.google/gemini-3-1-pro-video",
    locale: "en",
  },
  {
    id: "7",
    source: {
      publisher: "Dwarkesh Patel",
      kindLabel: "Podcast（RSS·访谈）",
    },
    featured: false,
    title: "Dario Amodei 谈 2027 年以前 AI 的关键路径",
    summary:
      "Anthropic CEO Dario Amodei 在 Dwarkesh Patel 播客上表示，他认为 2026 下半年将出现第一批能够独立完成整周级项目的 coding agent，而 2027 年底之前 AI 辅助的科研发现会集中爆发。访谈中也谈及公司在可解释性与合规路径上的投入。",
    tags: ["Agent", "Anthropic", "观点"],
    importance: 72,
    tier: "all",
    publishedAt: hoursAgo(52, 5),
    url: "https://www.dwarkeshpatel.com/p/dario-amodei-2027",
    locale: "en",
  },
  {
    id: "8",
    source: {
      publisher: "机器之心",
      kindLabel: "媒体报道（RSSHub·国内）",
    },
    featured: false,
    title: "字节豆包大模型团队发表可组合工具 Agent 框架",
    summary:
      "豆包大模型团队在 arXiv 预印本发布 MosaicAgent 框架，提出将工具调用拆解为可组合的原子操作，并以图结构进行调度。团队报告在 ToolBench 上相比 ReAct 有 11% 的平均提升。",
    tags: ["Agent", "字节", "发表成果"],
    importance: 70,
    tier: "all",
    publishedAt: hoursAgo(60, 30),
    url: "https://arxiv.org/abs/2604.00123",
    locale: "zh",
  },
];
