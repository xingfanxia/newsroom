/**
 * AI HOT daily-report fetch worker — provides the must-cover baseline that
 * `runDailyColumn` injects into its prompt as a `<aihot-daily>` block.
 *
 * Cache model:
 * - Once we've persisted a newsletters row with aihot_daily_payload for a
 *   given date, we read it back instead of hitting AI HOT's API.
 * - Cache key is `aihot_daily_date` (YYYY-MM-DD UTC).
 *
 * Graceful degradation:
 * - 404 from AI HOT (no report for that date) → return null
 * - Any other AihotError → log + return null
 * - Network failure → log + return null
 *
 * Never throws: callers can `if (aihot) { ... }` and proceed regardless.
 *
 * Window alignment caveat:
 * - AI HOT publishes at 00:05 UTC for the prior 24h (their date YYYY-MM-DD
 *   covers roughly windowStart=date-2 19:00 → date-1 19:00 UTC, i.e. Beijing
 *   day windows).
 * - Our daily column at 05:00 UTC has windowStart = 05:00 - 24h.
 * - Result: ~10h overlap with their "today" date. We pass `utcYmdFromDate(now)`
 *   and let the column generator treat AI HOT's pool as advisory (must-cover
 *   only for items still in our window's time range).
 */
import { sql, and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { newsletters } from "@/db/schema";
import {
  fetchDailyByDate,
  AihotError,
  type AihotDailyReport,
} from "@/lib/sources/aihot";

/** Render a Date as YYYY-MM-DD in UTC. Suitable for AI HOT daily endpoint. */
export function utcYmdFromDate(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Fetch (or read from cache) AI HOT daily for a UTC date.
 *
 * Returns null on missing / failure — callers must handle the null path
 * gracefully and proceed without AI HOT input.
 */
export async function fetchAihotDailyForDate(
  dateUtcYmd: string,
): Promise<AihotDailyReport | null> {
  // YYYY-MM-DD shape guard — defensive against caller typos.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateUtcYmd)) {
    console.warn(
      `[aihot-daily] invalid date format "${dateUtcYmd}" — expected YYYY-MM-DD`,
    );
    return null;
  }

  // ── 1. Cache lookup ─────────────────────────────────────────────
  const client = db();
  const cached = await client
    .select({ payload: newsletters.aihotDailyPayload })
    .from(newsletters)
    .where(
      and(
        eq(newsletters.aihotDailyDate, dateUtcYmd),
        sql`${newsletters.aihotDailyPayload} IS NOT NULL`,
      ),
    )
    .limit(1);

  if (cached.length > 0 && cached[0]!.payload) {
    return stripPaperFromAihotDaily(
      cached[0]!.payload as unknown as AihotDailyReport,
    );
  }

  // ── 2. Live fetch ───────────────────────────────────────────────
  try {
    const payload = await fetchDailyByDate(dateUtcYmd);
    return stripPaperFromAihotDaily(payload); // null on 404 — that's fine, propagate
  } catch (err) {
    if (err instanceof AihotError) {
      console.warn(
        `[aihot-daily] AihotError(${err.code}) for ${dateUtcYmd}: ${err.message}`,
      );
    } else {
      console.warn(
        `[aihot-daily] unexpected failure for ${dateUtcYmd}:`,
        err instanceof Error ? err.message : err,
      );
    }
    return null;
  }
}

/**
 * Render an AihotDailyReport into the prompt-injection block format consumed
 * by daily-column.md's must-cover rule. Returns empty string for null payload
 * — callers can unconditionally string-concatenate.
 */
export function renderAihotDailyForPrompt(
  payload: AihotDailyReport | null,
): string {
  payload = stripPaperFromAihotDaily(payload);
  if (!payload) return "";

  const leadBlock = payload.lead
    ? `lead:
  title: ${payload.lead.title}
  ${payload.lead.leadParagraph ? `paragraph: ${payload.lead.leadParagraph}` : ""}`.trim()
    : "lead: (none)";

  const sectionsBlock = payload.sections
    .map((sec) => {
      const items = sec.items
        .map(
          (item) =>
            `    - ${item.title} [${item.sourceName}] ${item.sourceUrl}\n      ${item.summary}`,
        )
        .join("\n");
      return `  ${sec.label}:\n${items || "    (no items)"}`;
    })
    .join("\n");

  const flashesBlock = payload.flashes
    .map((f) => `  - ${f.title} [${f.sourceName}] ${f.sourceUrl}`)
    .join("\n");

  return `<aihot-daily date="${payload.date}" generated="${payload.generatedAt}" window_start="${payload.windowStart}" window_end="${payload.windowEnd}">
${leadBlock}

sections:
${sectionsBlock}

flashes:
${flashesBlock || "  (none)"}
</aihot-daily>`;
}

export function stripPaperFromAihotDaily(
  payload: AihotDailyReport | null,
): AihotDailyReport | null {
  if (!payload) return null;

  const paperTitles = new Set<string>();
  const sections = payload.sections.filter((sec) => {
    if (sec.label !== "论文研究") return true;
    for (const item of sec.items) paperTitles.add(item.title);
    return false;
  });

  const lead =
    payload.lead && paperTitles.has(payload.lead.title) ? null : payload.lead;
  const flashes = payload.flashes.filter((f) => !paperTitles.has(f.title));

  return { ...payload, lead, sections, flashes };
}
