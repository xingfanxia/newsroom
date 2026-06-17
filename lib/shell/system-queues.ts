export type SystemQueueName =
  | "normalize"
  | "article-body"
  | "enrich"
  | "commentary"
  | "event-commentary"
  | "score";

export type SystemQueue = {
  name: SystemQueueName;
  depth: number;
  rate: string;
  p95Ms: number | null;
  driftS: number;
};

type SystemQueueConfig = Readonly<{
  name: SystemQueueName;
  rate: string;
}>;

export const SYSTEM_QUEUE_CONFIGS = [
  { name: "normalize", rate: "≈ 280/hr" },
  { name: "article-body", rate: "≈ 20-300/15m" },
  { name: "enrich", rate: "≈ 60/15m" },
  { name: "commentary", rate: "≈ 200/30m" },
  { name: "event-commentary", rate: "≈ 8/30m" },
  { name: "score", rate: "≈ 120/15m" },
] as const satisfies readonly SystemQueueConfig[];

export const SYSTEM_QUEUE_NAMES = SYSTEM_QUEUE_CONFIGS.map((q) => q.name);

const SYSTEM_QUEUE_CONFIG_BY_NAME = new Map(
  SYSTEM_QUEUE_CONFIGS.map((config) => [config.name, config]),
);

export function systemQueueSnapshot(
  name: SystemQueueName,
  depth: number,
): SystemQueue {
  const config = SYSTEM_QUEUE_CONFIG_BY_NAME.get(name);
  if (!config) {
    throw new Error(`unknown system queue: ${name}`);
  }
  return {
    name,
    depth,
    rate: config.rate,
    p95Ms: null,
    driftS: 0,
  };
}
