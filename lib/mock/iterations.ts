import type {
  FeedbackEntry,
  IterationConsoleLine,
  DiffLine,
  PolicyVersion,
} from "@/lib/types";

const base = new Date();
function ago(minutes: number): string {
  return new Date(base.getTime() - minutes * 60_000).toISOString();
}

export const mockFeedback: FeedbackEntry[] = [
  {
    id: "fb1",
    verdict: "up",
    title: "Claude Code 推出「自动模式」权限管理",
    note: "最近 Claude 的内容的权重可以提高",
    createdAt: ago(40),
  },
  {
    id: "fb2",
    verdict: "down",
    title: "逆向分析 Claude 对 CVE-2026-2796 漏洞的利用程序",
    note: "有点过于偏专业开发向了，不利于媒体传播",
    createdAt: ago(41),
  },
  {
    id: "fb3",
    verdict: "up",
    title: "小米发布多模态大模型 MIMO-V2-OMNI",
    note: "小米发布大模型，还是值得更高分的，这个大家很关心",
    createdAt: ago(22 * 60),
  },
  {
    id: "fb4",
    verdict: "down",
    title: "安全地使用 Sora 进行创作",
    note: "没什么用，Sora 现在不是热点，还是跟安全相关，分数应该更低",
    createdAt: ago(22 * 60 + 5),
  },
  {
    id: "fb5",
    verdict: "down",
    title: "为智能体工具实现快速正则表达式搜索：文本索引方法",
    note: "过于技术了，普通人看不太懂",
    createdAt: ago(22 * 60 + 10),
  },
  {
    id: "fb6",
    verdict: "down",
    title: "运用长周期智能体工作流推进科学计算：以构建可微分玻尔兹曼求解器为例",
    note: "过于科研了，普通人看不懂",
    createdAt: ago(22 * 60 + 15),
  },
  {
    id: "fb7",
    verdict: "up",
    title: "让 Claude 在您的电脑上工作",
    note: "这个都可以对标 OpenClaw 了，很重要，在现在这个时间节点，能打到 90 多分，更高分",
    createdAt: ago(22 * 60 + 20),
  },
  {
    id: "fb8",
    verdict: "up",
    title: "小米推出 mimo-v2-pro，持续探索智能交互",
    note: "",
    createdAt: ago(24 * 60),
  },
  {
    id: "fb9",
    verdict: "down",
    title: "氛围物理：AI 研究生——当前 AI 在理论物理研究中的能力测试与局限",
    note: "过于理论过去学术了，不是大家所关心的",
    createdAt: ago(5 * 24 * 60),
  },
  {
    id: "fb10",
    verdict: "down",
    title: "在 Amazon Bedrock 中为智能体引入有状态运行时环境",
    note: "感觉是 OpenAI 在为 Amazon 打广告，这个不值得精选",
    createdAt: ago(9 * 24 * 60),
  },
];

export const mockConsoleLines: IterationConsoleLine[] = [
  { key: "boot", kind: "info" },
  { key: "loadFeedback", kind: "info" },
  {
    key: "loadedFeedback",
    kind: "done",
    params: { total: 10, agreed: 4, disagreed: 6 },
  },
  { key: "agentStart", kind: "info" },
  { key: "sessionOpen", kind: "done" },
  { key: "procedureStart", kind: "done" },
  {
    key: "readFile",
    kind: "reading",
    params: { path: "modules/feed/runtime/policy/skills/editorial.skill.md" },
  },
  { key: "working", kind: "info" },
  { key: "finishing", kind: "done" },
  { key: "done", kind: "success" },
  { key: "versioned", kind: "success", params: { version: "v3" } },
];

export const mockDiffLines: DiffLine[] = [
  { kind: "meta", content: "### 具体修改" },
  { kind: "context", content: "" },
  {
    kind: "add",
    content: "1. **受众偏好** — 新增两条正向信号：",
  },
  {
    kind: "add",
    content: "   - Anthropic/Claude 实质性更新 → importance 上调 3~5 分",
  },
  {
    kind: "add",
    content:
      "   - 国内主流 AI 公司（小米/百度/阿里等）发布新模型 → 应视同头部厂商合理评分",
  },
  { kind: "context", content: "" },
  {
    kind: "add",
    content: "2. **通常不精选的内容** — 新增 4 条明确规则：",
  },
  {
    kind: "add",
    content: "   - 技术实现细节过深（CVE 逆向、底层算法）",
  },
  {
    kind: "add",
    content: "   - 传统科学领域结合 AI 的研究（物理、科学计算等）",
  },
  { kind: "add", content: "   - 云厂商促销性内容" },
  {
    kind: "add",
    content: "   - 已过气话题（无重大突破则不选）",
  },
  { kind: "context", content: "" },
  {
    kind: "add",
    content:
      "3. **约束规则** — 新增**技术可及性检测**：内容若需深度专业背景且无上手路径，importance 强制下调 10~15 分。",
  },
  { kind: "context", content: "" },
  {
    kind: "add",
    content:
      "4. **从反馈学到的偏好** — 从空白到填入 5 条有时间戳的经验记录，便于追踪迭代历史。",
  },
  { kind: "context", content: "" },
  { kind: "meta", content: "### 未做的事（刻意保持克制）" },
  { kind: "context", content: "" },
  {
    kind: "remove",
    content:
      "- 没有修改 `论文/研究` 的门槛数字（82分），因为问题根源是 importance 打分过高",
  },
  {
    kind: "remove",
    content:
      "- 没有把具体案例（CVE编号、小米型号）写入规则——避免过拟合，用模式而非案例描述规则",
  },
];

export const mockVersionHistory: PolicyVersion[] = [
  { version: "v3", committedAt: base.toISOString(), feedbackCount: 10 },
  {
    version: "v2",
    committedAt: new Date(base.getTime() - 7 * 86_400_000).toISOString(),
    feedbackCount: 14,
  },
  {
    version: "v1",
    committedAt: new Date(base.getTime() - 14 * 86_400_000).toISOString(),
    feedbackCount: 0,
  },
];
