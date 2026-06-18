#!/usr/bin/env bun
/**
 * Repair historical AI HOT daily placeholder rows created with non-standard
 * newsletter windows before import-aihot-daily-history.ts shared the
 * daily-column 05:00Z window helper.
 *
 * Default mode is dry-run. The apply path only touches placeholder rows with
 * no authored newsletter fields and story_count=0.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { closeDb, db } from "@/db/client";
import { newsletters } from "@/db/schema";
import { DAILY_COLUMN_LOCALE, DAILY_NEWSLETTER_KIND } from "@/lib/types";
import {
  dailyColumnWindowForDate,
  type NewsletterWindow,
} from "@/workers/newsletter/windows";

type Flags = {
  apply: boolean;
};

export type AihotPlaceholderRow = {
  id: number;
  aihotDailyDate: string;
  periodStart: Date;
  periodEnd: Date;
  aihotDailyPayload: unknown;
};

export type AihotTargetRow = {
  id: number;
  periodStart: Date;
  aihotDailyPayload: unknown | null;
};

export type AihotWindowRepairGroup = {
  date: string;
  canonicalStart: Date;
  canonicalEnd: Date;
  keeperId: number;
  keeperKind: "existing-target" | "placeholder";
  copyPayloadFromId: number | null;
  updateWindowRowId: number | null;
  deleteRowIds: number[];
};

function parseArgs(argv: string[]): Flags {
  const flags: Flags = { apply: false };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--apply") {
      flags.apply = true;
      continue;
    }
    if (arg === "--dry-run") {
      flags.apply = false;
      continue;
    }
    throw new Error(`unknown flag: ${arg}`);
  }
  return flags;
}

function printUsage(): void {
  console.log(`repair-aihot-daily-windows.ts

Repair AI HOT placeholder rows whose period_start does not match the
daily-column 05:00Z window.

Flags:
  --dry-run   Print planned row moves/deletes only (default).
  --apply     Apply the repair in one DB transaction.
  --help      Print this message.`);
}

function dateKey(d: Date): string {
  return d.toISOString();
}

function canonicalWindowForRow(row: AihotPlaceholderRow): NewsletterWindow {
  return dailyColumnWindowForDate(row.aihotDailyDate);
}

function isAlreadyCanonical(row: AihotPlaceholderRow): boolean {
  const window = canonicalWindowForRow(row);
  return dateKey(row.periodStart) === dateKey(window.start);
}

export function planAihotDailyWindowRepairGroups(
  placeholderRows: AihotPlaceholderRow[],
  targetRows: AihotTargetRow[],
): AihotWindowRepairGroup[] {
  const targetsByPeriodStart = new Map(
    targetRows.map((row) => [dateKey(row.periodStart), row]),
  );
  const placeholdersByPeriodStart = new Map<string, AihotPlaceholderRow[]>();

  for (const row of placeholderRows) {
    if (isAlreadyCanonical(row)) continue;
    const window = canonicalWindowForRow(row);
    const key = dateKey(window.start);
    const rows = placeholdersByPeriodStart.get(key) ?? [];
    rows.push(row);
    placeholdersByPeriodStart.set(key, rows);
  }

  return [...placeholdersByPeriodStart.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, rows]) => {
      rows.sort((a, b) => a.id - b.id);
      const first = rows[0]!;
      const window = canonicalWindowForRow(first);
      const target = targetsByPeriodStart.get(key);

      if (target) {
        return {
          date: first.aihotDailyDate,
          canonicalStart: window.start,
          canonicalEnd: window.end,
          keeperId: target.id,
          keeperKind: "existing-target",
          copyPayloadFromId: target.aihotDailyPayload == null ? first.id : null,
          updateWindowRowId: null,
          deleteRowIds: rows.map((row) => row.id),
        } satisfies AihotWindowRepairGroup;
      }

      return {
        date: first.aihotDailyDate,
        canonicalStart: window.start,
        canonicalEnd: window.end,
        keeperId: first.id,
        keeperKind: "placeholder",
        copyPayloadFromId: null,
        updateWindowRowId: first.id,
        deleteRowIds: rows.slice(1).map((row) => row.id),
      } satisfies AihotWindowRepairGroup;
    });
}

async function loadSafePlaceholderRows(): Promise<AihotPlaceholderRow[]> {
  const rows = await db()
    .select({
      id: newsletters.id,
      aihotDailyDate: newsletters.aihotDailyDate,
      periodStart: newsletters.periodStart,
      periodEnd: newsletters.periodEnd,
      aihotDailyPayload: newsletters.aihotDailyPayload,
    })
    .from(newsletters)
    .where(
      and(
        eq(newsletters.kind, DAILY_NEWSLETTER_KIND),
        eq(newsletters.locale, DAILY_COLUMN_LOCALE),
        isNull(newsletters.columnTitle),
        isNull(newsletters.headline),
        isNull(newsletters.overview),
        isNull(newsletters.highlights),
        isNull(newsletters.commentary),
        sql`${newsletters.storyCount} = 0`,
        sql`${newsletters.aihotDailyDate} IS NOT NULL`,
        sql`${newsletters.aihotDailyPayload} IS NOT NULL`,
      ),
    );

  return rows.flatMap((row) => {
    if (!row.aihotDailyDate || row.aihotDailyPayload == null) return [];
    return [
      {
        id: row.id,
        aihotDailyDate: row.aihotDailyDate,
        periodStart: row.periodStart,
        periodEnd: row.periodEnd,
        aihotDailyPayload: row.aihotDailyPayload,
      },
    ];
  });
}

async function loadTargetRows(
  placeholderRows: AihotPlaceholderRow[],
): Promise<AihotTargetRow[]> {
  const targetStarts = [
    ...new Set(
      placeholderRows.map((row) =>
        dateKey(canonicalWindowForRow(row).start),
      ),
    ),
  ].map((iso) => new Date(iso));

  if (targetStarts.length === 0) return [];

  return db()
    .select({
      id: newsletters.id,
      periodStart: newsletters.periodStart,
      aihotDailyPayload: newsletters.aihotDailyPayload,
    })
    .from(newsletters)
    .where(
      and(
        eq(newsletters.kind, DAILY_NEWSLETTER_KIND),
        eq(newsletters.locale, DAILY_COLUMN_LOCALE),
        inArray(newsletters.periodStart, targetStarts),
      ),
    );
}

function printPlan(groups: AihotWindowRepairGroup[], apply: boolean): void {
  console.log(
    `mode=${apply ? "APPLY" : "DRY-RUN"} repair_groups=${groups.length}`,
  );
  for (const group of groups) {
    const actions = [
      group.copyPayloadFromId
        ? `copy_payload ${group.copyPayloadFromId}->${group.keeperId}`
        : null,
      group.updateWindowRowId
        ? `move_placeholder ${group.updateWindowRowId}`
        : null,
      group.deleteRowIds.length > 0
        ? `delete_placeholders ${group.deleteRowIds.join(",")}`
        : null,
    ]
      .filter(Boolean)
      .join("; ");
    console.log(
      `[${group.date}] keeper=${group.keeperId} ${group.keeperKind} window=${group.canonicalStart.toISOString()}..${group.canonicalEnd.toISOString()} ${actions || "noop"}`,
    );
  }
}

async function applyPlan(
  groups: AihotWindowRepairGroup[],
  placeholdersById: Map<number, AihotPlaceholderRow>,
): Promise<void> {
  await db().transaction(async (tx) => {
    for (const group of groups) {
      if (group.copyPayloadFromId) {
        const source = placeholdersById.get(group.copyPayloadFromId);
        if (!source) {
          throw new Error(`missing source row ${group.copyPayloadFromId}`);
        }
        await tx
          .update(newsletters)
          .set({
            aihotDailyPayload: source.aihotDailyPayload,
            aihotDailyDate: source.aihotDailyDate,
          })
          .where(eq(newsletters.id, group.keeperId));
      }

      if (group.updateWindowRowId) {
        await tx
          .update(newsletters)
          .set({
            periodStart: group.canonicalStart,
            periodEnd: group.canonicalEnd,
          })
          .where(eq(newsletters.id, group.updateWindowRowId));
      }

      if (group.deleteRowIds.length > 0) {
        await tx
          .delete(newsletters)
          .where(inArray(newsletters.id, group.deleteRowIds));
      }
    }
  });
}

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2));
  const placeholders = await loadSafePlaceholderRows();
  const targets = await loadTargetRows(placeholders);
  const groups = planAihotDailyWindowRepairGroups(placeholders, targets);
  printPlan(groups, flags.apply);

  if (!flags.apply) return;
  await applyPlan(
    groups,
    new Map(placeholders.map((row) => [row.id, row])),
  );
  console.log("repair complete");
}

if (import.meta.main) {
  main()
    .catch((err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeDb();
    });
}
