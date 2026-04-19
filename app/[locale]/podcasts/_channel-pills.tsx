"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTweaks } from "@/hooks/use-tweaks";

export type ChannelPill = {
  id: string;
  nameEn: string;
  nameZh: string;
  count: number;
};

/**
 * Inline channel-filter pills for /podcasts. Writes ?source=<id> and lets
 * the server render the filtered feed.
 */
export function PodcastChannelPills({
  channels,
  activeId,
}: {
  channels: ChannelPill[];
  activeId: string | null;
}) {
  const pathname = usePathname();
  const { tweaks } = useTweaks();
  const zh = tweaks.language === "zh";
  return (
    <div className="fil-grp" style={{ flexWrap: "wrap", gap: 2 }}>
      <Link
        href={pathname}
        className={`fil ${!activeId ? "on" : ""}`}
        style={{ textDecoration: "none", borderBottomWidth: 0 }}
      >
        {zh ? "全部" : "all"}
      </Link>
      {channels.map((c) => (
        <Link
          key={c.id}
          href={`${pathname}?source=${encodeURIComponent(c.id)}`}
          className={`fil ${activeId === c.id ? "on" : ""}`}
          style={{ textDecoration: "none", borderBottomWidth: 0 }}
        >
          {zh ? c.nameZh : c.nameEn}
          <span className="c">{c.count}</span>
        </Link>
      ))}
    </div>
  );
}
