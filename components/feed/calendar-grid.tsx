import Link from "next/link";
import type { DayBucket } from "@/lib/shell/dashboard-stats";

/**
 * Month-grid calendar for browsing the feed by day. Mirrors the terminal
 * aesthetic: bordered cells, monospace numerals, accent-green activity
 * fill scaled by item count. Click a cell → `?date=YYYY-MM-DD`.
 *
 * Pass `days` newest→oldest (matches getDayCounts output). The grid lays
 * them out newest-first across up to `monthsBack` calendar months so users
 * can walk backwards through the backfill.
 */
export function CalendarGrid({
  days,
  active,
  basePath,
  preserveSource,
  locale,
  monthsBack = 2,
}: {
  days: DayBucket[];
  active?: string;
  basePath: string;
  preserveSource?: string;
  locale: "en" | "zh";
  monthsBack?: number;
}) {
  const zh = locale === "zh";

  const build = (date?: string) => {
    const qs = new URLSearchParams();
    if (date) qs.set("date", date);
    if (preserveSource && preserveSource !== "all")
      qs.set("source", preserveSource);
    const s = qs.toString();
    return `${basePath}${s ? `?${s}` : ""}`;
  };

  const counts = new Map(days.map((d) => [d.date, d.count]));
  const peak = Math.max(1, ...days.map((d) => d.count));

  // Build month buckets newest-first. monthsBack=2 → current month + prior.
  const today = new Date();
  const months = Array.from({ length: monthsBack }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  // Mon-first week order matches the Chinese calendar convention.
  const dowLabels = zh
    ? ["一", "二", "三", "四", "五", "六", "日"]
    : ["M", "T", "W", "T", "F", "S", "S"];

  const monthName = (y: number, m: number) =>
    new Intl.DateTimeFormat(zh ? "zh-CN" : "en-US", {
      month: "long",
      year: "numeric",
    }).format(new Date(y, m, 1));

  return (
    <div className="calendar-wrap" aria-label={zh ? "日历浏览" : "browse by day"}>
      <div className="calendar-head">
        <span className="t">{zh ? "按日期浏览" : "browse by day"}</span>
        {active ? (
          <Link className="clear" href={build(undefined)} scroll={false}>
            {zh ? "清除筛选" : "clear filter"} ✕
          </Link>
        ) : (
          <span className="meta">
            {days.reduce((a, d) => a + d.count, 0)} {zh ? "项" : "items"} ·{" "}
            {days.length} {zh ? "天" : "days"}
          </span>
        )}
      </div>
      <div className="calendar-months">
        {months.map(({ year, month }) => {
          const first = new Date(year, month, 1);
          const daysInMonth = new Date(year, month + 1, 0).getDate();
          // Mon=0 .. Sun=6 offset for the first day of the month
          const firstDow = (first.getDay() + 6) % 7;
          const cells: ({ day: number; iso: string } | null)[] = [];
          for (let i = 0; i < firstDow; i++) cells.push(null);
          for (let d = 1; d <= daysInMonth; d++) {
            const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
            cells.push({ day: d, iso });
          }
          while (cells.length % 7 !== 0) cells.push(null);

          return (
            <div key={`${year}-${month}`} className="calendar-month">
              <div className="calendar-month-hd">{monthName(year, month)}</div>
              <div className="calendar-dow">
                {dowLabels.map((l, i) => (
                  <span key={i}>{l}</span>
                ))}
              </div>
              <div className="calendar-cells">
                {cells.map((c, i) => {
                  if (!c) return <span key={i} className="calendar-cell empty" />;
                  const count = counts.get(c.iso) ?? 0;
                  const intensity = count === 0 ? 0 : Math.max(0.08, count / peak);
                  const isActive = active === c.iso;
                  const isFuture =
                    new Date(c.iso + "T23:59:59Z").getTime() > today.getTime() + 864e5;
                  if (isFuture) {
                    return (
                      <span key={i} className="calendar-cell future">
                        <span className="d">{c.day}</span>
                      </span>
                    );
                  }
                  return (
                    <Link
                      key={i}
                      href={build(c.iso)}
                      className="calendar-cell"
                      data-active={isActive ? "true" : "false"}
                      data-empty={count === 0 ? "true" : "false"}
                      title={`${c.iso} · ${count} ${zh ? "项" : "items"}`}
                      scroll={false}
                      style={
                        count > 0
                          ? {
                              // accent-green at scaled opacity, active = full solid
                              backgroundColor: isActive
                                ? "var(--accent-green)"
                                : `color-mix(in srgb, var(--accent-green) ${intensity * 60}%, transparent)`,
                              color: isActive ? "var(--bg-0)" : "var(--fg-1)",
                            }
                          : undefined
                      }
                    >
                      <span className="d">{c.day}</span>
                      {count > 0 && <span className="n">{count}</span>}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
