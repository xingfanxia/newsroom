import { describe, expect, test } from "bun:test";
import {
  planAihotDailyWindowRepairGroups,
  type AihotPlaceholderRow,
  type AihotTargetRow,
} from "@/scripts/ops/repair-aihot-daily-windows";

function placeholder(
  id: number,
  date: string,
  periodStart: string,
): AihotPlaceholderRow {
  return {
    id,
    aihotDailyDate: date,
    periodStart: new Date(periodStart),
    periodEnd: new Date(new Date(periodStart).getTime() + 24 * 60 * 60 * 1000),
    aihotDailyPayload: { id },
  };
}

function target(
  id: number,
  periodStart: string,
  hasPayload: boolean,
): AihotTargetRow {
  return {
    id,
    periodStart: new Date(periodStart),
    aihotDailyPayload: hasPayload ? { id } : null,
  };
}

describe("planAihotDailyWindowRepairGroups", () => {
  test("deletes misaligned placeholders when the canonical row already has payload", () => {
    const groups = planAihotDailyWindowRepairGroups(
      [placeholder(56, "2026-05-08", "2026-05-08T00:00:00.000Z")],
      [target(55, "2026-05-07T05:00:00.000Z", true)],
    );

    expect(groups).toEqual([
      {
        date: "2026-05-08",
        canonicalStart: new Date("2026-05-07T05:00:00.000Z"),
        canonicalEnd: new Date("2026-05-08T05:00:00.000Z"),
        keeperId: 55,
        keeperKind: "existing-target",
        copyPayloadFromId: null,
        updateWindowRowId: null,
        deleteRowIds: [56],
      },
    ]);
  });

  test("copies payload before deleting placeholders when the canonical row lacks payload", () => {
    const groups = planAihotDailyWindowRepairGroups(
      [placeholder(70, "2026-04-24", "2026-04-24T00:00:00.000Z")],
      [target(20, "2026-04-23T05:00:00.000Z", false)],
    );

    expect(groups[0]?.copyPayloadFromId).toBe(70);
    expect(groups[0]?.deleteRowIds).toEqual([70]);
    expect(groups[0]?.keeperId).toBe(20);
  });

  test("moves one placeholder and deletes duplicates when no canonical row exists", () => {
    const groups = planAihotDailyWindowRepairGroups(
      [
        placeholder(69, "2026-04-25", "2026-04-25T00:00:00.000Z"),
        placeholder(73, "2026-04-25", "2026-04-25T01:00:00.000Z"),
      ],
      [],
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.keeperId).toBe(69);
    expect(groups[0]?.keeperKind).toBe("placeholder");
    expect(groups[0]?.updateWindowRowId).toBe(69);
    expect(groups[0]?.deleteRowIds).toEqual([73]);
    expect(groups[0]?.canonicalStart.toISOString()).toBe(
      "2026-04-24T05:00:00.000Z",
    );
  });

  test("ignores placeholders that already use the canonical daily-column window", () => {
    const groups = planAihotDailyWindowRepairGroups(
      [placeholder(80, "2026-04-25", "2026-04-24T05:00:00.000Z")],
      [],
    );

    expect(groups).toEqual([]);
  });
});
