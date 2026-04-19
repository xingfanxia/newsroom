import Link from "next/link";
import type { DayBucket } from "@/lib/shell/dashboard-stats";

/**
 * Horizontal day-pill strip for `/all`. Each pill renders `MM·DD · N` and
 * links to `?date=YYYY-MM-DD`. The "all" pill clears the filter.
 *
 * Terminal-aesthetic: monospace pills with dashed borders, active day
 * switches to accent-green. Scrollable horizontally on narrow viewports.
 */
export function DayPicker({
  days,
  active,
  basePath,
  preserveSource,
  locale,
}: {
  days: DayBucket[];
  active?: string;
  basePath: string;
  preserveSource?: string;
  locale: "en" | "zh";
}) {
  const zh = locale === "zh";
  const build = (date?: string) => {
    const qs = new URLSearchParams();
    if (date) qs.set("date", date);
    if (preserveSource && preserveSource !== "all") qs.set("source", preserveSource);
    const s = qs.toString();
    return `${basePath}${s ? `?${s}` : ""}`;
  };

  return (
    <nav
      className="day-picker"
      aria-label={zh ? "按日期浏览" : "browse by day"}
      style={{
        display: "flex",
        gap: 6,
        overflowX: "auto",
        padding: "8px 0 10px",
        borderBottom: "1px solid var(--border-1)",
        marginBottom: 8,
        scrollbarWidth: "thin",
      }}
    >
      <Link
        href={build(undefined)}
        className="day-pill"
        data-active={active ? "false" : "true"}
      >
        <span className="d">{zh ? "全部" : "all"}</span>
      </Link>
      {days.map((d) => {
        const [, mm, dd] = d.date.split("-");
        return (
          <Link
            key={d.date}
            href={build(d.date)}
            className="day-pill"
            data-active={active === d.date ? "true" : "false"}
            title={d.date}
          >
            <span className="d">
              {mm}·{dd}
            </span>
            <span className="n">{d.count}</span>
          </Link>
        );
      })}
    </nav>
  );
}
