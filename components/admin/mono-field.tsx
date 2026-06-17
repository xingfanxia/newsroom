import type { ComponentPropsWithoutRef, CSSProperties } from "react";

type AdminMonoTextareaProps = Omit<
  ComponentPropsWithoutRef<"textarea">,
  "style"
> & {
  style?: CSSProperties;
};

type AdminMonoInputProps = Omit<
  ComponentPropsWithoutRef<"input">,
  "style"
> & {
  style?: CSSProperties;
};

const BASE_MONO_FIELD_STYLE = {
  background: "var(--bg-1)",
  border: "1px solid var(--border-1)",
  color: "var(--fg-1)",
  fontFamily: "var(--font-mono)",
  outline: "none",
  borderRadius: 2,
} satisfies CSSProperties;

export function AdminMonoTextarea({
  style,
  ...props
}: AdminMonoTextareaProps) {
  return (
    <textarea
      spellCheck={false}
      {...props}
      style={{
        ...BASE_MONO_FIELD_STYLE,
        fontSize: 12.5,
        lineHeight: 1.7,
        padding: 14,
        resize: "vertical",
        minHeight: 480,
        ...style,
      }}
    />
  );
}

export function AdminMonoInput({ style, ...props }: AdminMonoInputProps) {
  return (
    <input
      {...props}
      style={{
        ...BASE_MONO_FIELD_STYLE,
        fontSize: 12,
        padding: "8px 10px",
        ...style,
      }}
    />
  );
}
