import { Badge } from "@/components/ui/badge";
import { ExternalLink, Rss } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LiveSource } from "@/lib/sources/live";

type Locale = "zh" | "en";

export function SourceRow({
  source,
  locale,
  cadenceLabel,
}: {
  source: LiveSource;
  locale: Locale;
  cadenceLabel: string;
}) {
  const linkTarget = source.url.startsWith("internal://") ? "#" : source.url;
  return (
    <tr className="border-b border-[var(--color-border-subtle)] last:border-0 hover:bg-white/[0.02] transition-colors">
      <td className="px-5 py-3">
        <a
          href={linkTarget}
          target={linkTarget === "#" ? undefined : "_blank"}
          rel={linkTarget === "#" ? undefined : "noreferrer"}
          className="group inline-flex items-center gap-2 font-[510] text-[var(--color-fg)] hover:text-[var(--color-cyan)] transition-colors"
        >
          <StatusDot status={source.health.status} />
          <Rss
            size={13}
            className="text-[var(--color-fg-dim)] group-hover:text-[var(--color-cyan)] transition-colors"
          />
          <span>{source.name[locale === "zh" ? "zh" : "en"]}</span>
          {linkTarget !== "#" && (
            <ExternalLink
              size={11}
              className="text-[var(--color-fg-faint)] opacity-0 group-hover:opacity-100 transition-opacity"
            />
          )}
        </a>
        {source.notes && (
          <div className="mt-1 text-[12px] text-[var(--color-fg-dim)]">
            {source.notes}
          </div>
        )}
      </td>
      <td className="px-5 py-3 font-mono text-[12px] uppercase tabular text-[var(--color-fg-muted)]">
        {source.kind}
      </td>
      <td className="px-5 py-3 text-[12px] text-[var(--color-fg-muted)]">
        {source.locale}
      </td>
      <td className="px-5 py-3 text-[12px] text-[var(--color-fg-muted)]">
        {cadenceLabel}
      </td>
      <td className="px-5 py-3 font-mono text-[12px] tabular text-right text-[var(--color-fg-muted)]">
        {source.health.totalItemsCount.toLocaleString(
          locale === "zh" ? "zh-CN" : "en-US",
        )}
      </td>
      <td className="px-5 py-3 pr-6 text-right">
        <Badge
          variant={
            source.priority === 1
              ? "cyan"
              : source.priority === 2
                ? "default"
                : "outline"
          }
        >
          P{source.priority}
        </Badge>
      </td>
    </tr>
  );
}

function StatusDot({
  status,
}: {
  status: "ok" | "warning" | "error" | "pending";
}) {
  const colorClass =
    status === "ok"
      ? "bg-[var(--color-positive)] shadow-[0_0_8px_rgba(34,197,94,0.5)]"
      : status === "warning"
        ? "bg-[var(--color-warning)] shadow-[0_0_8px_rgba(245,158,11,0.5)]"
        : status === "error"
          ? "bg-[var(--color-negative)] shadow-[0_0_8px_rgba(239,68,68,0.5)]"
          : "bg-[var(--color-fg-faint)]";
  return (
    <span
      aria-label={`status-${status}`}
      className={cn("inline-block h-2 w-2 rounded-full", colorClass)}
    />
  );
}
