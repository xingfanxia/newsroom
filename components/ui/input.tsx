import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type = "text", ...props }, ref) => (
  <input
    ref={ref}
    type={type}
    className={cn(
      "h-10 w-full rounded-[8px] bg-white/[0.03] border border-[var(--color-border)]",
      "px-3.5 text-[15px] text-[var(--color-fg)] placeholder:text-[var(--color-fg-dim)]",
      "transition-colors focus:outline-none focus:border-[rgba(62,230,230,0.4)] focus:shadow-[0_0_0_3px_rgba(62,230,230,0.1)]",
      "disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";
