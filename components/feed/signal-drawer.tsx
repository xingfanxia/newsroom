"use client";

import { useEffect, useState } from "react";
import type { Story } from "@/lib/types";

type Member = NonNullable<Story["members"]>[number];

type Props = {
  clusterId: number | undefined;
  locale: "zh" | "en";
  showZh: boolean;
  open: boolean;
  onClose: () => void;
};

/**
 * Signal drawer — lists the members of a multi-member event on demand.
 *
 * Fetches /api/events/:id/members only when first opened (not on feed render)
 * so a 40-item feed doesn't trigger 40 N+1 calls. Members are cached in local
 * state for the lifetime of the component; closing + reopening the drawer
 * for the same cluster reuses the cache.
 *
 * Accessibility: drawer opens inline below the card (not modal), keyboard
 * close via the × button. Link rows open source URLs in new tabs with
 * noopener.
 */
export function SignalDrawer({ clusterId, locale, showZh, open, onClose }: Props) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !clusterId || members !== null) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/events/${clusterId}/members?locale=${locale}`, {
      cache: "no-store",
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`status ${r.status}`);
        const body = await r.json();
        if (cancelled) return;
        const mapped: Member[] = (body.members ?? []).map(
          (m: {
            source_id: string;
            source_name: string;
            title: string;
            url: string;
            published_at: string;
            importance: number;
          }) => ({
            sourceId: m.source_id,
            sourceName: m.source_name,
            title: m.title,
            url: m.url,
            publishedAt: m.published_at,
            importance: m.importance,
          }),
        );
        setMembers(mapped);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setMembers([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, clusterId, locale, members]);

  if (!open) return null;

  const headerText = showZh
    ? `由 ${members?.length ?? 0} 个信源报道`
    : `${members?.length ?? 0} sources covering this event`;

  return (
    <div
      className="signal-drawer"
      role="region"
      aria-label={headerText}
      onClick={(e) => e.stopPropagation()}
    >
      <header className="signal-drawer__header">
        <span className="signal-drawer__title">{headerText}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={showZh ? "关闭" : "close"}
          className="signal-drawer__close"
        >
          ×
        </button>
      </header>
      {loading && (
        <p className="signal-drawer__loading">
          {showZh ? "加载中…" : "loading…"}
        </p>
      )}
      {!loading && error && (
        <p className="signal-drawer__error">
          {showZh ? `加载失败：${error}` : `failed: ${error}`}
        </p>
      )}
      {!loading && !error && members && (
        <ul className="signal-drawer__list">
          {members.map((m) => (
            <li key={m.url} className="signal-drawer__member">
              <a
                href={m.url}
                target="_blank"
                rel="noopener noreferrer"
                className="signal-drawer__link"
              >
                <span className="signal-drawer__source">📎 {m.sourceName}</span>
                <span className="signal-drawer__time">
                  {formatRelative(m.publishedAt, showZh)}
                </span>
                <span className="signal-drawer__member-title">{m.title}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatRelative(iso: string, showZh: boolean): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return showZh ? "刚刚" : "just now";
  if (mins < 60) return showZh ? `${mins}分钟前` : `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return showZh ? `${hrs}小时前` : `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return showZh ? `${days}天前` : `${days}d ago`;
}
