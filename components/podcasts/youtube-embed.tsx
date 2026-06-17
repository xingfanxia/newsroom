import { extractYouTubeId } from "@/lib/urls/media";

export { extractYouTubeId };

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
