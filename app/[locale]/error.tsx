"use client";

export default function LocaleError({
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center gap-5 px-6 text-center">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--fg-2)]">
        Snapshot temporarily unavailable
      </p>
      <h1 className="text-2xl font-semibold text-[var(--fg-0)]">
        内容暂时不可用
      </h1>
      <p className="max-w-lg text-sm leading-6 text-[var(--fg-1)]">
        The latest public snapshot could not be loaded. Please retry in a moment.
      </p>
      <button
        type="button"
        className="border border-[var(--border-1)] bg-[var(--bg-1)] px-4 py-2 font-mono text-sm text-[var(--fg-0)] hover:border-[var(--accent-green)]"
        onClick={unstable_retry}
      >
        Retry / 重试
      </button>
    </main>
  );
}
