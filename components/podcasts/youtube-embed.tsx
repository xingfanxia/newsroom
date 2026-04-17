/**
 * Inline YouTube player for the podcast detail page. Only renders when the
 * URL is recognised as a YouTube video; otherwise the caller should fall
 * back to a plain "listen at source" link.
 *
 * Accepts the standard three URL shapes: /watch?v=, youtu.be/, /shorts/.
 */
export function YouTubeEmbed({
  url,
  title,
}: {
  url: string;
  title?: string;
}) {
  const id = extractYouTubeId(url);
  if (!id) return null;

  return (
    <div className="aspect-video w-full overflow-hidden rounded-xl border border-[var(--color-border)] bg-black">
      <iframe
        src={`https://www.youtube.com/embed/${id}`}
        title={title ?? "YouTube video"}
        className="h-full w-full"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        loading="lazy"
      />
    </div>
  );
}

export function extractYouTubeId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");

    if (host === "youtu.be") {
      const id = parsed.pathname.slice(1).split("/")[0];
      return isValidYouTubeId(id) ? id : null;
    }

    if (host === "youtube.com" || host === "m.youtube.com") {
      if (parsed.pathname === "/watch") {
        const id = parsed.searchParams.get("v");
        return id && isValidYouTubeId(id) ? id : null;
      }
      const shortsMatch = parsed.pathname.match(/^\/shorts\/([^/?#]+)/);
      if (shortsMatch) {
        return isValidYouTubeId(shortsMatch[1]) ? shortsMatch[1] : null;
      }
      const embedMatch = parsed.pathname.match(/^\/embed\/([^/?#]+)/);
      if (embedMatch) {
        return isValidYouTubeId(embedMatch[1]) ? embedMatch[1] : null;
      }
    }

    return null;
  } catch {
    return null;
  }
}

function isValidYouTubeId(id: string): boolean {
  return /^[A-Za-z0-9_-]{8,}$/.test(id);
}
