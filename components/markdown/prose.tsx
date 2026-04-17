import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Markdown renderer with the radar's prose styling baked in. Intentionally
 * defined in one place so every long-form surface (editor analysis, transcripts,
 * newsletters later) shares the same typographic rhythm.
 *
 * - headings: semibold, tighter tracking, scale down to h4
 * - paragraphs: 14.5px / 1.7 leading, muted foreground
 * - lists: disc/decimal with subdued markers
 * - code / pre: JetBrains Mono, panel background
 * - links: cyan with underline offset
 */
const COMPONENTS: Components = {
  h1: (props) => (
    <h1
      {...props}
      className="mt-8 mb-3 text-[22px] font-[590] tracking-[-0.44px] leading-snug text-[var(--color-fg)]"
    />
  ),
  h2: (props) => (
    <h2
      {...props}
      className="mt-7 mb-2.5 text-[19px] font-[590] tracking-[-0.32px] leading-snug text-[var(--color-fg)]"
    />
  ),
  h3: (props) => (
    <h3
      {...props}
      className="mt-5 mb-2 text-[16px] font-[590] tracking-[-0.2px] leading-snug text-[var(--color-fg)]"
    />
  ),
  h4: (props) => (
    <h4
      {...props}
      className="mt-4 mb-2 text-[14.5px] font-[590] text-[var(--color-fg)]"
    />
  ),
  p: (props) => (
    <p
      {...props}
      className="my-3 text-[14.5px] leading-[1.7] text-[var(--color-fg-muted)]"
    />
  ),
  ul: (props) => (
    <ul
      {...props}
      className="my-3 list-disc space-y-1.5 pl-5 text-[14.5px] leading-[1.7] text-[var(--color-fg-muted)] marker:text-[var(--color-fg-faint)]"
    />
  ),
  ol: (props) => (
    <ol
      {...props}
      className="my-3 list-decimal space-y-1.5 pl-5 text-[14.5px] leading-[1.7] text-[var(--color-fg-muted)] marker:text-[var(--color-fg-faint)]"
    />
  ),
  li: (props) => <li {...props} className="pl-0.5" />,
  a: ({ href, ...rest }) => (
    <a
      {...rest}
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-[var(--color-cyan)] underline underline-offset-4 decoration-[var(--color-cyan)]/40 hover:decoration-[var(--color-cyan)] transition-colors"
    />
  ),
  strong: (props) => (
    <strong {...props} className="font-[590] text-[var(--color-fg)]" />
  ),
  em: (props) => <em {...props} className="italic" />,
  blockquote: (props) => (
    <blockquote
      {...props}
      className="my-4 border-l-2 border-[var(--color-cyan)]/50 bg-[rgba(62,230,230,0.04)] px-4 py-2 text-[14px] leading-[1.65] text-[var(--color-fg-muted)]"
    />
  ),
  code: ({ className, children, ...rest }) => {
    // react-markdown emits inline vs fenced code through the same component;
    // treat the presence of a language-* className as a block-level hint.
    const isBlock = /language-/.test(className ?? "");
    if (isBlock) {
      return (
        <code
          {...rest}
          className={`${className ?? ""} block font-mono text-[13px] leading-[1.6] text-[var(--color-fg)]`}
        >
          {children}
        </code>
      );
    }
    return (
      <code
        {...rest}
        className="rounded bg-white/[0.06] px-1 py-0.5 font-mono text-[12.5px] text-[var(--color-fg)]"
      >
        {children}
      </code>
    );
  },
  pre: (props) => (
    <pre
      {...props}
      className="my-4 overflow-x-auto rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-panel)] p-4 text-[13px] leading-[1.6]"
    />
  ),
  hr: () => <hr className="my-6 border-[var(--color-border-subtle)]" />,
  table: (props) => (
    <div className="my-4 overflow-x-auto">
      <table
        {...props}
        className="min-w-full border-collapse text-[13.5px] text-[var(--color-fg-muted)]"
      />
    </div>
  ),
  th: (props) => (
    <th
      {...props}
      className="border-b border-[var(--color-border)] px-3 py-2 text-left font-[590] text-[var(--color-fg)]"
    />
  ),
  td: (props) => (
    <td
      {...props}
      className="border-b border-[var(--color-border-subtle)] px-3 py-2"
    />
  ),
};

export function Prose({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
      {children}
    </ReactMarkdown>
  );
}
