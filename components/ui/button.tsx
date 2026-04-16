import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-[510] text-sm transition-all disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none",
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--color-cyan)] text-[var(--color-canvas)] shadow-[0_0_24px_rgba(62,230,230,0.18),inset_0_0_0_1px_rgba(255,255,255,0.2)] hover:bg-[var(--color-cyan-hover)] hover:-translate-y-[1px]",
        ghost:
          "bg-white/[0.03] text-[var(--color-fg)] border border-[var(--color-border)] hover:bg-white/[0.05] hover:border-white/10",
        outline:
          "bg-transparent text-[var(--color-fg)] border border-[var(--color-border)] hover:bg-white/[0.03]",
        subtle:
          "bg-transparent text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-white/[0.04]",
        icon: "bg-transparent text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-white/[0.05]",
      },
      size: {
        sm: "h-8 px-3 text-[13px]",
        md: "h-9 px-4 text-sm",
        lg: "h-10 px-5 text-[15px]",
        icon: "h-8 w-8 p-0",
        iconSm: "h-7 w-7 p-0",
      },
    },
    defaultVariants: { variant: "ghost", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { buttonVariants };
