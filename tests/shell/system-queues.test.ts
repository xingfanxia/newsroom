import { describe, expect, test } from "bun:test";
import {
  SYSTEM_QUEUE_CONFIGS,
  SYSTEM_QUEUE_NAMES,
  systemQueueSnapshot,
} from "@/lib/shell/system-queues";

describe("system queue metadata", () => {
  test("keeps queue order and rates in one contract", () => {
    expect(SYSTEM_QUEUE_NAMES).toEqual([
      "normalize",
      "enrich",
      "commentary",
      "event-commentary",
      "score",
    ]);

    expect(SYSTEM_QUEUE_CONFIGS.map((q) => q.rate)).toEqual([
      "≈ 280/hr",
      "≈ 60/15m",
      "≈ 200/30m",
      "≈ 8/30m",
      "≈ 120/15m",
    ]);
  });

  test("builds queue snapshots with stable defaults", () => {
    expect(systemQueueSnapshot("enrich", 42)).toEqual({
      name: "enrich",
      depth: 42,
      rate: "≈ 60/15m",
      p95Ms: null,
      driftS: 0,
    });
  });
});
