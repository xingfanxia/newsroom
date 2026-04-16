import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-[4px] px-2 py-[2px] font-[510] text-[11px] leading-tight tabular whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "bg-white/[0.05] text-[var(--color-fg-muted)]",
        cyan:
          "bg-[rgba(62,230,230,0.12)] text-[var(--color-cyan)]",
        positive:
          "bg-[rgba(34,197,94,0.14)] text-[var(--color-positive)] font-mono",
        warning:
          "bg-[rgba(245,158,11,0.14)] text-[var(--color-warning)] rounded-full px-[10px]",
        outline:
          "bg-transparent text-[var(--color-fg-muted)] border border-[var(--color-border)]",
      },
      size: {
        sm: "text-[11px] px-2 py-[2px]",
        md: "text-[12px] px-[10px] py-[3px]",
      },
    },
    defaultVariants: { variant: "default", size: "sm" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, size, ...props }: BadgeProps) {
  return (
    <span
      className={cn(badgeVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { badgeVariants };
